//! Share images. The window draws the card, since it has the fonts and the
//! colours; this only puts the finished PNG where the player will look for it.

use std::path::{Path, PathBuf};

/// A card is about a megabyte at most; anything far past that is not one.
const MAX_BYTES: usize = 16 * 1024 * 1024;
const PNG_MAGIC: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

fn share_dir() -> Result<PathBuf, String> {
    dirs::picture_dir()
        .or_else(dirs::home_dir)
        .map(|dir| dir.join("千曲"))
        .ok_or_else(|| "找不到“图片”文件夹。".to_string())
}

/// The name is built here from a checked date, never taken from the caller,
/// so nothing the window sends can point outside the folder.
fn file_name(date: &str, shape: &str) -> Option<String> {
    let bytes = date.as_bytes();
    let dated = bytes.len() == 10
        && bytes
            .iter()
            .enumerate()
            .all(|(i, b)| if i == 4 || i == 7 { *b == b'-' } else { b.is_ascii_digit() });
    let suffix = match shape {
        "portrait" => "",
        "square" => " 方形",
        _ => return None,
    };
    dated.then(|| format!("千曲 {date}{suffix}.png"))
}

fn write(dir: &Path, date: &str, shape: &str, data: &[u8]) -> Result<PathBuf, String> {
    let name = file_name(date, shape).ok_or("分享图的日期或比例无效。")?;
    if data.len() > MAX_BYTES || !data.starts_with(&PNG_MAGIC) {
        return Err("分享图的数据无效。".into());
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("无法创建文件夹：{e}"))?;
    let path = dir.join(name);
    // Whole or not at all: a half-written picture would still open as a file.
    let temp = path.with_extension("png.tmp");
    std::fs::write(&temp, data)
        .and_then(|()| std::fs::rename(&temp, &path))
        .map_err(|e| {
            let _ = std::fs::remove_file(&temp);
            format!("无法保存图片：{e}")
        })?;
    Ok(path)
}

/// Saves today's card into Pictures\千曲 and answers with where it went.
/// The same day and shape overwrite each other, so sharing twice leaves one file.
#[tauri::command]
pub fn save_share_image(date: String, shape: String, data: Vec<u8>) -> Result<String, String> {
    write(&share_dir()?, &date, &shape, &data).map(|path| path.display().to_string())
}

#[tauri::command]
pub fn open_share_folder() -> Result<(), String> {
    let dir = share_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建文件夹：{e}"))?;
    let opener = if cfg!(windows) { "explorer" } else { "xdg-open" };
    std::process::Command::new(opener)
        .arg(&dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("无法打开文件夹：{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png() -> Vec<u8> {
        let mut data = PNG_MAGIC.to_vec();
        data.extend_from_slice(b"rest of the picture");
        data
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("taktdock-share-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn the_file_is_named_from_a_checked_date_and_shape() {
        assert_eq!(file_name("2026-11-19", "portrait").as_deref(), Some("千曲 2026-11-19.png"));
        assert_eq!(file_name("2026-11-19", "square").as_deref(), Some("千曲 2026-11-19 方形.png"));
        for date in ["", "2026-11-1", "2026/11/19", "..\\..\\x.png", "2026-11-19x", "２０２６-11-19"] {
            assert_eq!(file_name(date, "portrait"), None, "{date}");
        }
        assert_eq!(file_name("2026-11-19", "../wide"), None);
    }

    #[test]
    fn a_card_is_written_whole_and_replaces_the_same_days_card() {
        let dir = scratch("write");
        let path = write(&dir, "2026-11-19", "portrait", &png()).unwrap();
        assert_eq!(path.parent(), Some(dir.as_path()));
        assert_eq!(std::fs::read(&path).unwrap(), png());

        let mut second = png();
        second.push(7);
        assert_eq!(write(&dir, "2026-11-19", "portrait", &second).unwrap(), path);
        assert_eq!(std::fs::read(&path).unwrap(), second);
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1, "no temporary file is left behind");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_a_png_of_a_sane_size_is_accepted() {
        let dir = scratch("reject");
        assert!(write(&dir, "2026-11-19", "portrait", b"not a picture").is_err());
        assert!(write(&dir, "2026-11-19", "portrait", &[]).is_err());
        let mut huge = png();
        huge.resize(MAX_BYTES + 1, 0);
        assert!(write(&dir, "2026-11-19", "portrait", &huge).is_err());
        assert!(write(&dir, "tomorrow", "portrait", &png()).is_err());
        assert!(!dir.exists(), "nothing is created for a rejected card");
    }
}
