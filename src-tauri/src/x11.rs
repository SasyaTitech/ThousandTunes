//! The X11 side of the widget: one connection, and the questions that need it.
//!
//! Three things on Linux can only be answered by the window system: where the
//! panel is, whether something has been stacked over the widget, and what the
//! widget's own window id is so the first two can be acted on. All of them are
//! X11 questions, and all of them work inside a Wayland session too, because
//! the app asks the GTK backend to run on XWayland (see `linux::prefer_x11`).
//!
//! Nothing here opens another process, reads another process's memory or
//! injects anything. It reads properties the EWMH specification exists to
//! publish, and asks the window manager to raise one window: this one.

use crate::monitor::Rect;

/// Which edge of a monitor a panel sits on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Edge {
    Top,
    Bottom,
    Left,
    Right,
}

impl Edge {
    pub fn horizontal(self) -> bool {
        matches!(self, Edge::Top | Edge::Bottom)
    }
}

/// A panel found on a monitor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Panel {
    /// In root coordinates, clipped to the monitor it was found on.
    pub rect: Rect,
    pub edge: Edge,
    /// The panel reserves space, so windows do not open underneath it. An
    /// automatically hiding panel reserves nothing.
    pub reserves_space: bool,
    /// The rectangle came from a real dock window rather than from the work
    /// area, so it is the panel's own geometry rather than what it gave up.
    pub exact: bool,
}

/// The reserved band between a monitor's full bounds and its work area.
///
/// This is the one way of finding a panel that works in every session. In a
/// Wayland session the panel is a Wayland surface and no X11 client can see it,
/// but both mutter and kwin keep `_NET_WORKAREA` correct for the XWayland
/// clients they host, and GTK reads it for us. What the panel took is still the
/// shape of the panel.
///
/// Only horizontal edges are offered. A panel down the side of the screen
/// cannot host a strip two rows tall, the same way a vertical Windows taskbar
/// cannot, and the caller falls back to floating placement.
pub fn reserved_band(bounds: Rect, work: Rect) -> Option<(Edge, Rect)> {
    let top = (work.top - bounds.top).max(0);
    let bottom = (bounds.bottom - work.bottom).max(0);

    // The widest of the two, and nothing at all when neither reserves enough
    // to be a panel rather than a rounding difference.
    let (edge, size) = if top >= bottom {
        (Edge::Top, top)
    } else {
        (Edge::Bottom, bottom)
    };
    if size < MIN_PANEL_PX {
        return None;
    }

    let rect = match edge {
        Edge::Top => Rect {
            left: bounds.left,
            top: bounds.top,
            right: bounds.right,
            bottom: bounds.top + size,
        },
        _ => Rect {
            left: bounds.left,
            top: bounds.bottom - size,
            right: bounds.right,
            bottom: bounds.bottom,
        },
    };
    Some((edge, rect))
}

/// Thinner than this is a rounding difference or a decoration, not a panel.
const MIN_PANEL_PX: i32 = 12;

/// Which edge of the monitor this rectangle lies against, if any. A panel
/// touches the edge it is docked to and does not reach the opposite one.
pub fn edge_of(rect: Rect, bounds: Rect) -> Option<Edge> {
    let w = rect.right - rect.left;
    let h = rect.bottom - rect.top;
    if w <= 0 || h <= 0 {
        return None;
    }
    // Compositor rounding, not a deliberate gap.
    const SLACK: i32 = 2;

    if h < (bounds.bottom - bounds.top) / 2 {
        if (rect.top - bounds.top).abs() <= SLACK {
            return Some(Edge::Top);
        }
        if (rect.bottom - bounds.bottom).abs() <= SLACK {
            return Some(Edge::Bottom);
        }
    }
    if w < (bounds.right - bounds.left) / 2 {
        if (rect.left - bounds.left).abs() <= SLACK {
            return Some(Edge::Left);
        }
        if (rect.right - bounds.right).abs() <= SLACK {
            return Some(Edge::Right);
        }
    }
    None
}

/// Everything below needs an X server. Elsewhere, and in a Wayland session
/// with no XWayland, these answer nothing and the caller falls back.
#[cfg(target_os = "linux")]
pub use imp::{dock_on, ensure_above, is_available, our_window, panel_on};

#[cfg(not(target_os = "linux"))]
pub fn is_available() -> bool {
    false
}

#[cfg(not(target_os = "linux"))]
pub fn panel_on(_bounds: Rect, _work: Rect) -> Option<Panel> {
    None
}

#[cfg(not(target_os = "linux"))]
pub fn ensure_above(_title: &str, _ours: Rect) -> bool {
    false
}

#[cfg(target_os = "linux")]
mod imp {
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::OnceLock;

    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{
        AtomEnum, ClientMessageEvent, ConnectionExt, EventMask, StackMode, Window,
    };
    use x11rb::rust_connection::RustConnection;

    use super::{edge_of, reserved_band, Panel};
    use crate::monitor::Rect;

    /// `_NET_WM_STATE` client message: 0 removes, 1 adds, 2 toggles.
    const STATE_ADD: u32 = 1;

    pub struct Session {
        conn: RustConnection,
        root: Window,
        client_list: u32,
        client_list_stacking: u32,
        wm_state: u32,
        state_above: u32,
        window_type: u32,
        window_type_dock: u32,
        strut: u32,
        strut_partial: u32,
        wm_pid: u32,
        net_wm_name: u32,
        utf8_string: u32,
    }

    /// One connection for the life of the process. A session with no X server
    /// reachable is a permanent no rather than something to retry three times a
    /// second.
    pub fn session() -> Option<&'static Session> {
        static SESSION: OnceLock<Option<Session>> = OnceLock::new();
        SESSION
            .get_or_init(|| match connect() {
                Ok(session) => Some(session),
                Err(e) => {
                    tracing::info!("no X11 display, so no panel and no stacking control: {e}");
                    None
                }
            })
            .as_ref()
    }

    pub fn is_available() -> bool {
        session().is_some()
    }

    fn connect() -> Result<Session, Box<dyn std::error::Error>> {
        let (conn, screen) = x11rb::connect(None)?;
        let root = conn.setup().roots[screen].root;
        let atom = |name: &str| -> Result<u32, Box<dyn std::error::Error>> {
            Ok(conn.intern_atom(false, name.as_bytes())?.reply()?.atom)
        };

        Ok(Session {
            client_list: atom("_NET_CLIENT_LIST")?,
            client_list_stacking: atom("_NET_CLIENT_LIST_STACKING")?,
            wm_state: atom("_NET_WM_STATE")?,
            state_above: atom("_NET_WM_STATE_ABOVE")?,
            window_type: atom("_NET_WM_WINDOW_TYPE")?,
            window_type_dock: atom("_NET_WM_WINDOW_TYPE_DOCK")?,
            strut: atom("_NET_WM_STRUT")?,
            strut_partial: atom("_NET_WM_STRUT_PARTIAL")?,
            wm_pid: atom("_NET_WM_PID")?,
            net_wm_name: atom("_NET_WM_NAME")?,
            utf8_string: atom("UTF8_STRING")?,
            conn,
            root,
        })
    }

    fn property32(
        session: &Session,
        window: Window,
        property: u32,
        kind: impl Into<u32>,
    ) -> Vec<u32> {
        let Ok(cookie) = session
            .conn
            .get_property(false, window, property, kind.into(), 0, 1024)
        else {
            return Vec::new();
        };
        let Ok(reply) = cookie.reply() else {
            return Vec::new();
        };
        reply.value32().map(|v| v.collect()).unwrap_or_default()
    }

    /// Absolute position, which `get_geometry` alone does not give: its
    /// coordinates are relative to the parent, and a managed window's parent is
    /// the frame the window manager wrapped it in.
    fn geometry(session: &Session, window: Window) -> Option<Rect> {
        let size = session.conn.get_geometry(window).ok()?.reply().ok()?;
        let origin = session
            .conn
            .translate_coordinates(window, session.root, 0, 0)
            .ok()?
            .reply()
            .ok()?;
        Some(Rect::from_size(
            origin.dst_x as i32,
            origin.dst_y as i32,
            size.width as i32,
            size.height as i32,
        ))
    }

    fn intersects(a: Rect, b: Rect) -> bool {
        a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    }

    fn clip(rect: Rect, to: Rect) -> Rect {
        Rect {
            left: rect.left.max(to.left),
            top: rect.top.max(to.top),
            right: rect.right.min(to.right),
            bottom: rect.bottom.min(to.bottom),
        }
    }

    /// The panel docked to this monitor, as its own window says it is.
    ///
    /// Only an X11 session can answer: in a Wayland session the panel is a
    /// Wayland surface and is not in any X11 client list, however well XWayland
    /// hosts this app.
    pub fn dock_on(bounds: Rect) -> Option<Panel> {
        let session = session()?;
        let mut best: Option<(i32, Panel)> = None;

        for window in property32(session, session.root, session.client_list, AtomEnum::WINDOW) {
            let types = property32(session, window, session.window_type, AtomEnum::ATOM);
            if !types.contains(&session.window_type_dock) {
                continue;
            }
            let Some(rect) = geometry(session, window) else {
                continue;
            };
            if !intersects(rect, bounds) {
                continue;
            }
            let Some(edge) = edge_of(rect, bounds) else {
                continue;
            };

            // A panel that reserves nothing is one that hides itself.
            let reserves_space =
                !property32(session, window, session.strut_partial, AtomEnum::CARDINAL).is_empty()
                    || !property32(session, window, session.strut, AtomEnum::CARDINAL).is_empty();

            let clipped = clip(rect, bounds);
            let area = (clipped.right - clipped.left) * (clipped.bottom - clipped.top);
            let panel = Panel {
                rect: clipped,
                edge,
                reserves_space,
                exact: true,
            };
            // The widest dock on the monitor wins, so a notification area or a
            // small always-on-top helper cannot be mistaken for the panel.
            if best.map(|(seen, _)| area > seen).unwrap_or(true) {
                best = Some((area, panel));
            }
        }
        best.map(|(_, panel)| panel)
    }

    /// The panel on this monitor, by whichever route can see it.
    ///
    /// The dock window is preferred when it agrees with the reserved band,
    /// because it is the panel's own geometry rather than the space it gave up,
    /// and because only it can say whether the panel hides itself.
    pub fn panel_on(bounds: Rect, work: Rect) -> Option<Panel> {
        let band = reserved_band(bounds, work);
        let dock = dock_on(bounds);

        match (band, dock) {
            (Some((edge, _)), Some(dock)) if dock.edge == edge => Some(dock),
            (Some((edge, rect)), _) => Some(Panel {
                rect,
                edge,
                reserves_space: true,
                exact: false,
            }),
            // Nothing reserved, but a dock is there: an automatically hiding
            // panel, or one on a desktop that does not reserve space.
            (None, Some(dock)) if dock.edge.horizontal() => Some(dock),
            _ => None,
        }
    }

    /// This process's widget window, found by the two things only it has: our
    /// process id, and the title the window was created with.
    ///
    /// The accent colour picker is this process as well, which is why the title
    /// has to match too.
    pub fn our_window(title: &str) -> Option<Window> {
        static CACHED: AtomicU32 = AtomicU32::new(0);
        let session = session()?;

        let cached = CACHED.load(Ordering::Relaxed);
        if cached != 0 && window_title(session, cached).as_deref() == Some(title) {
            return Some(cached);
        }

        let pid = std::process::id();
        for window in property32(session, session.root, session.client_list, AtomEnum::WINDOW) {
            let owner = property32(session, window, session.wm_pid, AtomEnum::CARDINAL);
            if owner.first() != Some(&pid) {
                continue;
            }
            if window_title(session, window).as_deref() != Some(title) {
                continue;
            }
            CACHED.store(window, Ordering::Relaxed);
            return Some(window);
        }
        CACHED.store(0, Ordering::Relaxed);
        None
    }

    fn window_title(session: &Session, window: Window) -> Option<String> {
        let reply = session
            .conn
            .get_property(
                false,
                window,
                session.net_wm_name,
                session.utf8_string,
                0,
                256,
            )
            .ok()?
            .reply()
            .ok()?;
        if reply.value.is_empty() {
            return None;
        }
        Some(
            String::from_utf8_lossy(&reply.value)
                .trim_end_matches('\0')
                .to_string(),
        )
    }

    /// Puts the widget back on top when something has been stacked over it.
    ///
    /// Like the Windows side, this only acts when the widget is really covered,
    /// so other always-on-top windows are not fought with for no reason. The
    /// window manager is asked twice over: `_NET_WM_STATE_ABOVE` is the polite
    /// way and the one that lasts, the restack is what moves it now.
    pub fn ensure_above(title: &str, ours: Rect) -> bool {
        let Some(session) = session() else {
            return false;
        };
        let Some(window) = our_window(title) else {
            return false;
        };

        let stacking = property32(
            session,
            session.root,
            session.client_list_stacking,
            AtomEnum::WINDOW,
        );
        let Some(position) = stacking.iter().position(|w| *w == window) else {
            return false;
        };

        // Everything after us in the stacking order is above us.
        let covered = stacking[position + 1..].iter().any(|other| {
            geometry(session, *other)
                .map(|rect| intersects(rect, ours))
                .unwrap_or(false)
        });
        if !covered {
            return false;
        }

        let message = ClientMessageEvent::new(
            32,
            window,
            session.wm_state,
            [STATE_ADD, session.state_above, 0, 1, 0],
        );
        let _ = session.conn.send_event(
            false,
            session.root,
            EventMask::SUBSTRUCTURE_NOTIFY | EventMask::SUBSTRUCTURE_REDIRECT,
            message,
        );
        let _ = session.conn.configure_window(
            window,
            &x11rb::protocol::xproto::ConfigureWindowAux::new().stack_mode(StackMode::ABOVE),
        );
        let _ = session.conn.flush();
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Rect = Rect {
        left: 0,
        top: 0,
        right: 1920,
        bottom: 1080,
    };

    #[test]
    fn a_reserved_band_is_found_on_either_horizontal_edge() {
        // A GNOME top bar: 32 pixels off the top.
        let top = Rect {
            left: 0,
            top: 32,
            right: 1920,
            bottom: 1080,
        };
        let (edge, rect) = reserved_band(SCREEN, top).expect("a top panel");
        assert_eq!(edge, Edge::Top);
        assert_eq!(rect, Rect { left: 0, top: 0, right: 1920, bottom: 32 });

        // An XFCE panel at the bottom.
        let bottom = Rect {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1052,
        };
        let (edge, rect) = reserved_band(SCREEN, bottom).expect("a bottom panel");
        assert_eq!(edge, Edge::Bottom);
        assert_eq!(rect, Rect { left: 0, top: 1052, right: 1920, bottom: 1080 });
    }

    /// Ubuntu reserves the left for its dock and the top for the bar. Only a
    /// horizontal panel can hold a strip two rows tall, so the top wins and the
    /// dock is ignored rather than mistaken for a panel.
    #[test]
    fn a_side_dock_does_not_count_as_a_panel() {
        let work = Rect {
            left: 72,
            top: 32,
            right: 1920,
            bottom: 1080,
        };
        let (edge, rect) = reserved_band(SCREEN, work).expect("the top bar");
        assert_eq!(edge, Edge::Top);
        assert_eq!(rect.bottom - rect.top, 32);

        // Only the side reserved: nothing this widget can pin into.
        let side_only = Rect {
            left: 72,
            top: 0,
            right: 1920,
            bottom: 1080,
        };
        assert!(reserved_band(SCREEN, side_only).is_none());
    }

    #[test]
    fn a_full_work_area_means_no_panel() {
        assert!(reserved_band(SCREEN, SCREEN).is_none());
        // A couple of pixels is rounding, not a panel.
        let nearly = Rect {
            top: 3,
            ..SCREEN
        };
        assert!(reserved_band(SCREEN, nearly).is_none());
    }

    #[test]
    fn a_dock_is_placed_against_the_edge_it_touches() {
        let top_bar = Rect { left: 0, top: 0, right: 1920, bottom: 32 };
        assert_eq!(edge_of(top_bar, SCREEN), Some(Edge::Top));

        let bottom_bar = Rect { left: 0, top: 1036, right: 1920, bottom: 1080 };
        assert_eq!(edge_of(bottom_bar, SCREEN), Some(Edge::Bottom));

        let left_dock = Rect { left: 0, top: 32, right: 72, bottom: 1080 };
        assert_eq!(edge_of(left_dock, SCREEN), Some(Edge::Left));
        assert!(!edge_of(left_dock, SCREEN).unwrap().horizontal());

        // A floating panel, which KDE allows: against no edge at all.
        let floating = Rect { left: 400, top: 400, right: 1400, bottom: 444 };
        assert_eq!(edge_of(floating, SCREEN), None);

        // An ordinary window is not a panel however it is placed.
        let window = Rect { left: 0, top: 0, right: 1200, bottom: 900 };
        assert_eq!(edge_of(window, SCREEN), None);
    }
}
