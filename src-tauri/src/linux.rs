//! The Linux specific parts of the shell: which display backend to run on,
//! how the window is told to behave, and how to tell the machine is saving
//! power.
//!
//! Everything else on this platform is either shared with Windows or lives in
//! `x11.rs`.

use tauri::{AppHandle, Manager};

/// Overrides the choice below. `TAKTDOCK_BACKEND=wayland` runs on the Wayland
/// backend whatever the cost, which is the escape hatch if forcing X11 ever
/// turns out worse on some desktop.
const BACKEND_ENV: &str = "TAKTDOCK_BACKEND";

/// Asks GTK for the X11 backend when the session offers one.
///
/// Wayland has no protocol for a window to place itself on screen, and none for
/// asking what another window is doing. Both are deliberate. A widget that
/// docks to a corner, pins into a panel and gets out of the way of fullscreen
/// applications needs all three, so on Wayland it would be a different, much
/// smaller app.
///
/// Under XWayland it is an ordinary X client again, and mutter and kwin honour
/// where it asks to be. That is what makes placement, the panel and the
/// fullscreen sensor work on a GNOME or KDE Wayland session. What it costs is
/// scaling: an XWayland window on a fractionally scaled desktop is scaled by
/// the compositor rather than drawn at the new size, so it can look softer.
///
/// Must run before GTK is initialised, which means before the Tauri builder.
pub fn prefer_x11() {
    if let Some(choice) = std::env::var_os(BACKEND_ENV) {
        let choice = choice.to_string_lossy().to_string();
        tracing::info!("display backend forced to {choice} by {BACKEND_ENV}");
        std::env::set_var("GDK_BACKEND", choice);
        return;
    }
    if std::env::var_os("GDK_BACKEND").is_some() {
        return;
    }

    // Whether there is an X display, not whether this is an X session. GTK
    // picks the Wayland backend whenever a compositor is listening, and it
    // finds the socket by its default name rather than by `WAYLAND_DISPLAY`,
    // so asking about that variable answers the wrong question. `DISPLAY` is
    // the one that matters: where it is set, either this is an X session or
    // the compositor is running XWayland, and both are what the widget wants.
    // Not named `display`: inside a tracing macro that is the name of one of
    // its own helpers, and the format argument would resolve to it.
    let x_display = std::env::var("DISPLAY").unwrap_or_default();
    if x_display.is_empty() {
        tracing::warn!(
            "no X display: placement, panel docking and fullscreen hiding are not available in this session"
        );
        return;
    }

    let wayland = std::env::var("XDG_SESSION_TYPE").as_deref() == Ok("wayland");
    if wayland {
        tracing::info!("Wayland session with XWayland on {x_display}, using the X11 backend");
    } else {
        tracing::info!("X11 session on {x_display}");
    }
    std::env::set_var("GDK_BACKEND", "x11");
}

/// What the session turned out to be, for the diagnostic report.
pub fn session_description() -> String {
    let kind = std::env::var("XDG_SESSION_TYPE").unwrap_or_else(|_| "?".into());
    let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_else(|_| "?".into());
    let backend = std::env::var("GDK_BACKEND").unwrap_or_else(|_| "default".into());
    let x11 = if crate::x11::is_available() {
        "reachable"
    } else {
        "unreachable"
    };
    format!("{desktop} ({kind}), GDK backend {backend}, X11 {x11}")
}

/// The window hints that keep the widget out of the way: no focus when
/// clicked, nothing in the window list, and above the ordinary stack.
///
/// This is the Linux half of `window::apply_ex_styles`. GTK may only be touched
/// from the thread that owns the main loop, and this is called from the
/// reconciler as well as from setup, so the work is posted rather than done
/// here. A window that has never been realised is skipped: `show` calls this
/// again once it has been.
pub fn apply_window_hints(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        use gtk::prelude::*;

        let Some(window) = handle.get_webview_window(crate::window::WIDGET_LABEL) else {
            return;
        };
        let Ok(gtk_window) = window.gtk_window() else {
            return;
        };

        // `WS_EX_NOACTIVATE` in all but name: the window asks not to be given
        // the keyboard, so clicking the widget leaves the focus where it was.
        // It reaches the window manager as the ICCCM input hint.
        gtk_window.set_accept_focus(false);
        gtk_window.set_focus_on_map(false);
        // `WS_EX_TOOLWINDOW` in all but name.
        gtk_window.set_skip_taskbar_hint(true);
        gtk_window.set_skip_pager_hint(true);
        gtk_window.set_keep_above(true);
        // Utility rather than Dock. A dock window is kept above even a
        // fullscreen game on several window managers, which is the one thing
        // this widget must never do; hiding for fullscreen is handled by the
        // sensor, deliberately and with a delay.
        gtk_window.set_type_hint(gtk::gdk::WindowTypeHint::Utility);
    });
}

/// Puts the window where it belongs, at the size it should be, in one go.
///
/// Neither half is what it looks like on GTK. A window that has never been
/// given a default size of its own reports a natural size of 200 by 200,
/// whatever is inside it, and a window that is not resizable is pinned to that
/// natural size: the widget ends up floating in the middle of a box far taller
/// than its two rows, which is the bug a field report from Ubuntu described.
/// Lifting the resizable flag around the call does not help, because putting
/// the flag back brings the natural size back with it.
///
/// The two halves also have to happen in the same turn of the main loop.
/// Asking for a move and then queueing a resize leaves the toolkit to
/// reconcile two states that disagree, and what came back was a window a few
/// tens of pixels above where it was put. The move is repeated after the
/// resize because a window manager may answer a size change by shifting the
/// frame, and the result is read back once more below.
///
/// GTK may only be touched from the thread that owns the main loop, and
/// `reposition` runs on the reconciler, so the work is posted.
pub fn place(window: &tauri::WebviewWindow, x: i32, y: i32, w: u32, h: u32) {
    let scale = window.scale_factor().unwrap_or(1.0).max(0.1);
    let window = window.clone();
    let _ = window.app_handle().run_on_main_thread({
        let window = window.clone();
        move || {
            use gtk::prelude::*;

            let Ok(gtk_window) = window.gtk_window() else {
                return;
            };
            let (w, h) = (w as i32, h as i32);
            // GTK speaks in logical pixels, the caller in physical ones.
            let (lx, ly) = (
                (x as f64 / scale).round() as i32,
                (y as f64 / scale).round() as i32,
            );

            gtk_window.move_(lx, ly);

            // This is the line that makes the size stick. A GTK window reports
            // a natural size of its own even when everything inside it asks
            // for nothing, and a window that is not resizable is pinned to
            // that natural size, so a resize on its own is clamped straight
            // back to where it started. A size request overrides it.
            gtk_window.set_size_request(w, h);

            // Said again as hints, so the window manager is told rather than
            // left to work it out from an allocation it has not seen yet.
            let geometry = gtk::gdk::Geometry::new(
                w,
                h,
                w,
                h,
                -1,
                -1,
                -1,
                -1,
                0.0,
                0.0,
                gtk::gdk::Gravity::NorthWest,
            );
            gtk_window.set_geometry_hints(
                None::<&gtk::Widget>,
                Some(&geometry),
                gtk::gdk::WindowHints::MIN_SIZE | gtk::gdk::WindowHints::MAX_SIZE,
            );
            gtk_window.set_default_size(w, h);
            gtk_window.resize(w, h);
            gtk_window.move_(lx, ly);

            // And then checked. A window manager answers a size change in its
            // own way, and shrinking this one has been seen to leave it a
            // couple of dozen pixels above where it was put, with nothing
            // further to correct it: the next pass only runs when the desktop
            // itself changes. So the result is read once the toolkit has had
            // its turn, and put right if it disagrees.
            gtk::glib::timeout_add_local_once(std::time::Duration::from_millis(120), {
                let gtk_window = gtk_window.clone();
                move || {
                    let (got_x, got_y) = gtk_window.position();
                    if (got_x, got_y) != (lx, ly) {
                        tracing::debug!(
                            "the window settled at {got_x},{got_y} rather than {lx},{ly}, moving it again"
                        );
                        gtk_window.move_(lx, ly);
                    }
                }
            });
        }
    });
}

/// Is the machine trying to save power?
///
/// Windows answers this directly. Here the closest honest reading is the
/// battery: discharging and low. It only decides whether the beat animation
/// runs, never whether the click plays.
pub fn power_saver() -> bool {
    let Ok(entries) = std::fs::read_dir("/sys/class/power_supply") else {
        return false;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let read = |name: &str| {
            std::fs::read_to_string(path.join(name))
                .map(|v| v.trim().to_string())
                .unwrap_or_default()
        };
        if read("type") != "Battery" || read("status") != "Discharging" {
            continue;
        }
        if read("capacity").parse::<u32>().map(|c| c <= 20).unwrap_or(false) {
            return true;
        }
    }
    false
}

/// Lets the widget take the keyboard for as long as a menu is open.
///
/// The window refuses focus, which is the whole point of it: clicking it must
/// never take the keyboard away from what somebody is typing in. A GTK menu
/// popped from such a window is shown, and can be picked from with the mouse,
/// but it is never told that Escape was pressed and never closes, and the call
/// that opened it does not return until it does. So the refusal is lifted for
/// the life of the menu and put back the moment it closes.
///
/// `set_focusable` is used rather than the toolkit call directly because it
/// waits for the main thread to have applied it. Queueing the change instead
/// let the menu open first, and a menu that opens before the window will take
/// the keyboard is a menu that never closes.
pub struct MenuFocus(tauri::WebviewWindow);

impl MenuFocus {
    pub fn hold(window: &tauri::WebviewWindow) -> Self {
        let _ = window.set_focusable(true);
        // And taken, not merely allowed. A menu belonging to an X11 window is
        // only told about Escape while the X11 side holds the keyboard, and on
        // a Wayland session anything the user last clicked on the desktop
        // holds it instead. This is the same thing the Windows build does when
        // it brings the window forward for a menu.
        let _ = window.set_focus();
        Self(window.clone())
    }
}

impl Drop for MenuFocus {
    fn drop(&mut self) {
        let _ = self.0.set_focusable(false);
    }
}
