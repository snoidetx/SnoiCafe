# SnoiCafe 小小厨房 🍲

一款适合家人和朋友使用的免费开源菜单网页应用，支持英文和简体中文。左侧分类、右侧菜品列表，底部固定“菜单 / 心愿单 / 历史”。

食客只需要 **一个链接 + 昵称 + 厨房口令**。无需注册邮箱或 Google 账号。主厨使用独立的主厨密码管理菜单和访问权限。

## 先看本地预览

安装 Node.js 24 LTS 和 pnpm，在项目目录执行：

```sh
pnpm install
pnpm dev:demo
```

打开终端里的链接。预览支持切换主厨/食客，样例数据只保存在当前浏览器。正式构建不包含预览身份切换或样例菜品。预览不支持修改访问口令和备份；真实厨房使用 `pnpm dev`。

## 一次性设置

只有厨房主人需要完成以下步骤，之后家人直接打开链接即可。

1. 在 [Supabase](https://supabase.com/) 创建项目，在 Authentication → Sign In / Providers 开启 **Anonymous Sign-Ins（匿名登录）**。这是后台的设备会话，家人不需要注册账号。
2. 在 SQL Editor 中依次运行 [初始数据库脚本](../supabase/migrations/202609220001_kitchen.sql) 和 [访问口令更新脚本](../supabase/migrations/202609220002_unrestricted_credentials.sql)。初始脚本只在空项目运行一次；若已经执行过，只运行口令更新脚本即可。
3. 另开一个 SQL 查询，替换下面两个示例值后运行：

   ```sql
   select public.bootstrap_kitchen(
     p_chef_password := 'REPLACE-with-your-private-chef-password',
     p_kitchen_code := 'REPLACE-with-your-family-code',
     p_name := 'SnoiCafe'
   );
   ```

   厨房口令和主厨密码不设应用层面的长度限制，但两者均不能为空，且必须不同。支持中文和长口令，不会截断。真实口令不要写入 GitHub；SQL Editor 中含口令的查询也请保密。应用私有数据表只保存哈希。

4. 在 Supabase 的 Connect / API 设置中复制 **Project URL** 和 **publishable key**（也支持旧版 anon key）。不要使用 secret key 或 service_role key。
5. 在项目目录复制 `.env.example` 为 `.env.local`，填入这两个公开配置值：

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
   VITE_BASE_PATH=/
   ```

6. 运行 `pnpm dev`，选择“我是主厨”，输入昵称和主厨密码，即可开始添加菜品。

## 发布到 GitHub Pages

1. Fork 本项目或推送到自己的仓库，在 Settings → Pages 将 Source 设为 **GitHub Actions**。
2. 在 Settings → Secrets and variables → Actions → Variables 添加 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_PUBLISHABLE_KEY`。只填上述公开配置，不要添加主厨密码、厨房口令、数据库密码或服务端密钥。
3. 推送到 `main`，或在 Actions 中手动运行 **Deploy to GitHub Pages**。工作流会先测试再部署，自动处理仓库子路径；尚未配置变量时会跳过部署。
4. 将部署结果中的网址（通常为 `https://你的用户名.github.io/SnoiCafe/`）分享给家人，另外私下告知厨房口令。主厨密码不要给食客。

公开仓库可使用 GitHub Free 提供的 Pages；Supabase 免费方案通常足够小家庭使用，但有容量限制和闲置暂停机制，请查看 [最新价格](https://supabase.com/pricing)。代码仓库中没有你的菜品、照片、心愿或口令。GitHub Pages 只托管网页，Supabase 才负责共享数据和访问校验。

## 已有厨房更新

如果设置口令时出现长度限制错误，请在现有 Supabase 项目的 SQL Editor 中运行 [访问口令更新脚本](../supabase/migrations/202609220002_unrestricted_credentials.sql)，然后刷新更新后的网页。原有密码、口令、会话、菜单和点单都会保留。若首次创建厨房失败，先运行更新脚本，再用自己的密码和口令重试 `bootstrap_kitchen`。不要重新运行初始建表脚本。

## 日常使用

- **主厨：**添加照片、名称、介绍、趣味厨币价格、分类及口味选项；支持中英文名称/介绍。归档菜品不会删除历史点单。恢复的菜品默认暂不可点，请检查后再开放。
- **食客：**点菜或直接输入想吃的新菜名。点单和新菜心愿一起进入“心愿单”。食客可取消当前会话自己发出的待制作心愿；主厨可完成、取消及撤销完成。
- **语言：**点击右上角语言按钮。未填写中文名称时显示原名称，口味选项由主厨自行填写，不会自动翻译。
- **更换口令：**点击顶部设置按钮 → 厨房访问，输入新的厨房口令、主厨密码或两者，再点击“更新访问口令”。留空的项目保持不变。完成初始数据库设置或更新后，主厨可直接在应用内修改，无需再执行 SQL；食客没有此权限。更换厨房口令后所有食客需重新输入；更换主厨密码会结束其他主厨会话，但保留当前主厨。
- **设备会话：**当前浏览器会记住昵称和权限；退出、清除浏览器数据或换设备后会成为新会话。旧点单依然保留，但新会话不能取消旧会话发出的点单，主厨可以协助处理。
- **访问范围：**知道厨房口令的人都可以加入。若希望某人不再进入，请更换口令；仅“结束会话”无法阻止知道口令的人重新加入。数据库权限立即撤销；已打开的页面会在下次刷新时清除内容（在线且可见时最多 30 秒）。

## 备份与恢复

主厨可在设置中下载包含菜单、心愿、昵称、照片的 JSON 备份，请妥善保密。备份不包含口令、哈希或身份令牌。

“恢复菜单备份”只新增分类和菜品，不会覆盖原菜单，恢复后默认不可点单。导入不是数据库事务：中途网络失败可能已写入部分菜品，重试前请先检查。成员身份和历史无法通过便携菜单导入恢复；完整恢复还需数据库和 Storage 文件的独立备份。

忘记主厨密码时，Supabase 项目管理员可通过 SQL 重置哈希并结束旧主厨会话，详见 [英文恢复步骤](../README.md#backups-and-recovery)。不要删除有历史点单关联的 Auth 用户，结束其厨房会话即可。

本应用需要联网使用，没有离线点单或付款功能。可以在手机浏览器中添加主页快捷方式。完整技术说明见 [架构文档](architecture.md)。
