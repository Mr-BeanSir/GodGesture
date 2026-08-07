# 按键/文字序列语法

“按键/文字序列”命令使用一行一条语句的 DSL。GodGesture 按文件顺序执行语句，空行会被忽略；最多 64 条语句，`sleep` 最多等待 10000 毫秒。

```text
text "Hello, world!\n"
key Enter
hotkey Ctrl+Alt+Tab
sleep 500
```

`text "..."` 发送纯文本。参数是 JSON 字符串，因此可以使用 `\n`、`\t`、`\\` 和 `\"` 等转义。

`key KEY` 发送一个按键，例如 `Enter`、`Tab`、`Escape`、`Backspace`、`Delete`、`Left`、`Up`、`Right`、`Down`、`F1` 到 `F24`，或单个字母/数字。

`hotkey MODIFIER+KEY` 发送快捷键，例如 `Ctrl+S`、`Ctrl+Shift+P`、`Alt+F4`、`Meta+Left`。支持 `Ctrl`、`Alt`、`Shift` 和 `Meta`；`Meta` 在 Windows 映射为 Windows 键，在 macOS 映射为 Command 键。

`sleep MILLISECONDS` 暂停指定毫秒数，例如 `sleep 100`。未知语句、未闭合的 JSON 字符串、未知按键或修饰键都会在保存前被拒绝，并显示行号。
