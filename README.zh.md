# Multiverse Glass Match

[English](README.md) · 简体中文

一个使用 WebGL2 渲染的非商业浏览器三消游戏。在 **Otherworld Mode（异世界模式）** 中探索多元宇宙的幻想星球，开启 **Planet Mode（星球模式）** 后与熟悉的天体一起游玩。匹配的星球会在黏连的液态玻璃内融合，同时形成黑洞并被吸收。

[在线游玩](https://aenvo.github.io/multiverse-glass-match/) · [署名与素材来源](CREDITS.md) · [许可说明](LICENSE.md)

## 游玩

需要启用 WebGL2 的浏览器和鼠标。

- 按住鼠标左键拖动星球，与相邻格子交换。横向或纵向至少三个相同星球会触发融合、消除、补落与连锁。
- 关闭星球开关进入 **Otherworld Mode**。共有 34 种外观，包括 33 种 Orbkit 动态 shader 球与程序化生成的幻想星球 Azure world。
- 开启 **Planet Mode** 后可以选择地球、月球、水星、金星、火星和木星。每局使用四种外观。
- 点击书本按钮浏览当前模式图鉴与 GLSL 源码。点击齿轮选择四种星球，再点击 **Apply** 应用。
- 点击刷新按钮，重新随机选择当前模式的四种星球并重开棋盘。
- 点击主题开关切换浅色与暗色玻璃。外观与主题选择保存在当前标签页的会话存储中。

切换模式会保留棋盘排列。拖动或动画期间请求切换，会在棋盘稳定后生效。异世界模式的黑洞光晕从实际星球 shader 中采集颜色，熟悉天体使用暖色黑洞配色。融合与黑洞效果都在黏连玻璃内部完成。

## 本地运行

需要 Python 3 和支持 WebGL2 的浏览器，通过 HTTP 服务访问仓库。

```sh
git clone https://github.com/Aenvo/multiverse-glass-match.git
cd multiverse-glass-match
```

### Windows

双击 [start.cmd](start.cmd)，或在仓库目录中运行。

```cmd
start.cmd
```

启动脚本依次通过 `py -3`、`python` 或 `python3` 查找 Python。打开终端中显示的网址，按 `Ctrl+C` 停止服务。

### 其他环境

在仓库根目录执行以下命令，再打开 Python 输出的网址。

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

安装了 Node.js 和 npm 后，也可以使用 `npm start` 运行同一条 Python 命令。

## 开发

前端使用原生 JavaScript 模块、CSS 与 GLSL，文件由静态服务直接加载。星球材质实现在 [src/planet-shaders.js](src/planet-shaders.js)，使用有明确许可的表面贴图与 shader 内生成的程序化噪声。

在仓库根目录运行现有 Node.js 测试。

```sh
npm test
```

测试覆盖棋盘生成、合法交换、连通匹配分组、补落与连锁、重排、拖动惯性、外观恢复和黑洞几何。

GitHub Pages 从 `main` 分支根目录提供静态网站。资源地址相对于模块或页面解析，支持仓库 Pages 子路径。

## 署名与非商业使用

本项目用于非商业创作与学习。第三方代码、shader 和素材分别遵循其原始许可证与署名要求。

- **XorDev** 创作了 19 种 Orbkit 外观所依据的 shader，其条款要求非商业使用、署名和保留声明。
- **zzzzshawn** 创作了 Orbkit 运行时代码和 14 种原创外观，采用 MIT 许可。
- **Solar System Scope / INOVE** 提供月球、水星、金星、火星和木星贴图，采用 CC BY 4.0。地球贴图署名为 **NASA Visible Earth / Blue Marble**，遵循 NASA 媒体使用指南。
- 玻璃渲染参考、液态玻璃开关及黑洞光效参考保留各自的 MIT 声明。

[署名文件](CREDITS.md) 对应列出作者、固定上游版本、本地文件与适配情况。[许可总览](LICENSE.md) 说明项目自有部分的授权和各项第三方条款。
