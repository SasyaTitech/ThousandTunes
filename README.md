<img src="src-tauri/icons/qianqu/128x128@2x.png" width="84" alt="千曲的图标">

# 千曲 · Thousand Tunes

> 操千曲而后晓声，观千剑而后识器。——《文心雕龙·知音》

Windows 上的练琴记录本，带一台节拍器。选一条练习，按下开始，节拍器响着的时间就记到这条练习今天的记录里。

基于 [kalaylienes/taktdock](https://github.com/kalaylienes/taktdock)：节拍器沿用原项目，练习记录、教材、统计、分享图和界面是这个分支加的。

![主页](docs/qianqu/home.png)

| 练习 | 分享图 |
|---|---|
| ![练习页](docs/qianqu/practice.png) | ![分享图](docs/qianqu/card.png) |

## 下载

到 [Releases](https://github.com/SasyaTitech/taktdock/releases) 下载最新的 exe，直接运行，不用安装。程序没有代码签名，首次运行时 Windows 可能提示“未知发布者”。

## 功能

- **主页**：今天练了多久、连续打卡、打卡日历、教材进度，以及今日清单。
- **练习**：选中一条练习后，节拍器开着的时间自动计入；速度成绩自己录入。没选练习时记为“自由练习”。速度滑块下面可以直接切换预设。
- **教材**：从教材里挑出正在练的项目加入今日清单，达标后自动移出；可以补记和修改以前的记录。
- **分享图**：把当天的练习生成一张卡片，竖版或方形，可复制或保存。
- **跟拍**：接上吉他，显示每一下拨弦是早了还是晚了。只判断时机，不判断音高。
- **节拍器**：30–300 BPM、拍号、细分、音色、TAP 测速、预设和全局快捷键。空格键开始和停止。
- **配色和音量**：在左下角，点一下弹出。配色有八套。

内置教材大纲：帅帅《零基础入门电吉他 7 周自学计划 1》。只有标题、页码、每日时长和速度目标，不含正文和曲谱。

## 数据

练习记录在 `%APPDATA%\TaktDock-Practice\journal.json`，备份这个文件即可。保存的分享图在“图片\千曲”。

播放时约每 10 秒写入一次，播放中直接关掉窗口最多丢失最后 10 秒。

图标是一竖加三个圆点：写成数字是 1 000，也是一小节四拍里的重拍和另外三拍。源文件在 `src-tauri/icons/qianqu/`。

## 添加教材

在 `src/books/` 放一个 JSON 文件，重新构建后会出现在“教材”页：

```json
{
  "id": "my-book",
  "title": "教材名称",
  "weeks": [
    { "title": "第一周", "exercises": [
      { "id": "W1-EX1", "title": "练习名称", "page": 5, "minutes": 10, "tempo": { "from": 50, "to": 100 } }
    ] }
  ]
}
```

`tempo.to` 为 `null` 表示练到原速；`"unit": "percent"` 表示按原速百分比记录。`id` 有了记录后不要再改。

## 构建

需要 Node.js、Rust 和 Windows C++ Build Tools。

```sh
npm ci
npm run app:practice   # 生成 src-tauri/target/release/taktdock.exe
npm test               # 界面测试
npm run test:rust      # 后端测试
```

发布：改 `src-tauri/tauri.practice.conf.json` 里的版本号，推送同名标签（如 `1.0.0-practice.13`），GitHub Actions 会测试、构建并发布。

## 原项目

TaktDock 是停靠在任务栏上的节拍器小组件，源码仍在本仓库，用 `npm run app:build` 构建，说明见[原项目的 README](https://github.com/kalaylienes/taktdock#readme)。原项目的安装包不含这里的练习功能。

## 许可

GPL-3.0-or-later，见 [LICENSE](LICENSE)。教材本身的版权归作者所有。
