/* ============================================================
   绿角犀官网 轻量 i18n（zh / en / ja / ko / es / fr）
   - 仅翻译「框架文案」：导航、页脚、按钮、标题、表单标签、后台面板名等。
     长篇幅营销正文保持中文（站点主语言），避免半翻译割裂观感。
   - 用法：在元素上写 data-i18n="key"（替换文本）、
           data-i18n-ph="key"（替换 input placeholder）、
           data-i18n-title="key"（替换 title/aria-label）。
   - 缺失 key 时保留页面原有文本（兜底，绝不空白）。
   - 选择持久化到 localStorage('gr-lang')，并同步 <html lang>。
   - 语言切换为下拉选择器（.lang-select 容器由本脚本动态填充）。
   纯原生 JS，零依赖。
   ============================================================ */
(function () {
  'use strict';

  // 语言顺序（下拉菜单展示顺序）
  var LANGS = ['zh', 'en', 'ja', 'ko', 'es', 'fr'];
  // 各语言自名称（endonym），下拉选项固定显示，不进 DICT（语言名本身不被翻译）
  var LANG_NAMES = { zh: '中文', en: 'English', ja: '日本語', ko: '한국어', es: 'Español', fr: 'Français' };

  var DICT = {
    zh: {
      'nav.home': '首页', 'nav.company': '公司', 'nav.apps': '应用', 'nav.games': '游戏',
      'nav.contact': '联系', 'nav.download': '下载', 'nav.admin': '后台', 'nav.api': 'API 文档', 'nav.changelog': '更新动态',
      'nav.toggleTheme': '切换明暗主题', 'nav.searchPh': '搜索产品…', 'nav.searchInput': '搜索产品', 'nav.searchBtn': '搜索', 'nav.searchForm': '站内搜索', 'nav.menu': '打开菜单',
      'footer.copy': '© 2026 绿角犀 LVJIAOXI · 应用与游戏，触手可及',
      'footer.home': '首页', 'footer.contact': '联系我们', 'footer.api': 'API 文档', 'footer.admin': '后台管理',
      'footer.privacy': '隐私政策', 'footer.terms': '服务条款',
      'legal.privacyTitle': '隐私政策', 'legal.privacySub': '我们重视你的隐私。本政策说明我们收集哪些信息、如何使用与保护，以及你的相关权利。',
      'legal.termsTitle': '服务条款', 'legal.termsSub': '使用本站及下载、使用本网站提供的产品前，请阅读并同意以下条款。',
      'btn.refresh': '↻ 刷新数据', 'btn.autoOff': '自动刷新 关', 'btn.autoOn': '自动刷新 开', 'btn.checkUpdate': '↻ 检查更新',
      'btn.logout': '退出登录', 'btn.login': '登录',
      'btn.backHome': '返回首页', 'btn.retry': '重新尝试', 'btn.download': '下载', 'btn.submit': '发送留言', 'btn.sending': '发送中…',
      'err.quickNav': '快捷导航', 'err.search': '站内搜索', 'err.searchPh': '输入产品名称搜索…', 'err.searchEmpty': '未找到相关产品', 'err.searchOffline': '搜索需要联网，恢复网络后再试', 'err.matchCat': '分类', 'err.matchType': '类型', 'err.matchDesc': '描述',
      'pwa.update': '发现新版本，点击刷新即可更新', 'pwa.refresh': '刷新', 'pwa.close': '关闭',
      'readonly.banner': '当前为只读（viewer）账号，仅可查看数据，写操作已禁用。',
      'login.title': '绿角犀 后台', 'login.sub': '请输入管理员账号',
      'login.user': '用户名', 'login.pass': '口令',
      'login.userPh': '默认 admin', 'login.passPh': '默认 admin123',
      'login.err': '账号或口令错误', 'login.back': '← 返回官网',
      'dash.title': '数据看板', 'role.admin': '管理员', 'role.viewer': '只读',
      'panel.trend': '流量趋势', 'trend.days': '近 {n} 天', 'trend.dayUnit': '天', 'trend.total': '区间合计：浏览 {v} 次 · 下载 {d} 次', 'legend.views': '浏览量', 'legend.downloads': '下载量',
      'panel.products': '产品管理', 'panel.contacts': '联系留言', 'panel.audit': '操作审计日志',
      'panel.accesslog': '访问日志', 'panel.admins': '管理员管理',
      'admin.self': '当前账号', 'admin.delete': '删除', 'admin.roleTitle': '修改角色', 'admin.roleConfirm': '确定将「{name}」的角色改为「{role}」？', 'admin.confirm': '确认', 'admin.deleteTitle': '删除账号', 'admin.deleteConfirm': '确定删除账号「{name}」？此操作不可恢复。',
      'kpi.views': '总浏览量', 'kpi.downloads': '总下载量', 'kpi.products': '上架产品',
      'kpi.contacts': '联系留言', 'kpi.pending': '未处理留言', 'kpi.today': '今日浏览',
      'kpi.monitored': '监测页面', 'kpi.productCount': '产品数',
      'status.on': '已上架', 'status.off': '已下架', 'status.markPending': '标记未处理', 'status.markDone': '标记已处理',
      'type.app': '应用', 'type.game': '游戏', 'empty.none': '暂无数据', 'empty.referrers': '暂无引荐数据',
      'product.edit': '编辑', 'product.delete': '删除', 'contact.reply': '回复', 'contact.delete': '删除', 'contact.deleteTitle': '删除留言', 'contact.deleteConfirm': '确定删除这条留言？此操作不可恢复。', 'contact.selectAll': '全选本页', 'contact.markDoneSel': '标记已处理', 'contact.delSel': '删除选中', 'contact.batchCount': '已选 {n} 条', 'contact.delSelTitle': '批量删除留言', 'contact.delSelConfirm': '确定删除选中的 {n} 条留言？此操作不可恢复。', 'product.deleteTitle': '删除产品', 'product.deleteConfirm': '确定删除该产品「{name}」？此操作不可恢复。',
      'action.shelfOn': '上架', 'action.shelfOff': '下架',
      'bulk.selectAll': '全选当前结果', 'bulk.batchCount': '已选 {n} 个产品', 'bulk.shelfOn': '批量上架', 'bulk.shelfOff': '批量下架', 'bulk.category': '批量改分类', 'bulk.del': '删除选中', 'bulk.delTitle': '批量删除产品', 'bulk.delConfirm': '确定删除选中的 {n} 个产品？此操作不可恢复。', 'bulk.done': '操作成功', 'bulk.fail': '批量操作失败：', 'bulk.needSel': '请先勾选产品',
      'panel.maintenance': '站点维护模式', 'maint.desc': '开启后前台页面与公开 API 统一返回维护提示（后台与静态资源不受影响）。', 'maint.msg': '维护提示语（选填，前台维护页展示，≤200 字符）', 'maint.on': '开启维护', 'maint.off': '关闭维护', 'maint.statusOn': '维护中', 'maint.statusOff': '正常运行', 'maint.confirmTitle': '确认开启维护模式', 'maint.confirm': '开启后普通访客将无法访问前台，仅管理员可通过后台入口登录。', 'maint.done': '操作成功',
      'panel.feedback': '产品反馈', 'fb.filterProduct': '全部产品', 'fb.empty': '暂无反馈', 'fb.unrated': '未评分', 'fb.markDone': '标记已处理', 'fb.markPending': '重新打开', 'fb.delTitle': '删除反馈', 'fb.delConfirm': '确定删除这条反馈？此操作不可恢复。', 'fb.title': '用户反馈', 'fb.sub': '说说你使用这款产品的体验（评分选填）', 'fb.rate': '评分（选填）', 'fb.namePh': '怎么称呼你（选填）', 'fb.content': '反馈内容 *', 'fb.contentPh': '使用体验、建议或遇到的问题…', 'fb.submit': '提交反馈', 'fb.sending': '提交中…', 'fb.ok': '感谢你的反馈！', 'fb.err': '提交失败，请稍后再试', 'fb.need': '请填写反馈内容', 'fb.badMail': '邮箱格式不正确', 'search.feedback': '搜索反馈内容 / 称呼 / 邮箱…',
      'panel.fbOverview': '反馈概览', 'fb.avgBy': '已获 {n} 人评分', 'fb.recent': '最新评价', 'fb.anon': '匿名用户', 'fb.byProduct': '按产品分布', 'fb.week7': '近 7 天新增趋势', 'kpi.fbTotal': '反馈总数', 'kpi.fbPending': '未处理反馈', 'kpi.fbRated': '已评分', 'kpi.fbAvg': '平均分', 'btn.exportStats': '导出分析 CSV', 'chg.title': '产品更新动态', 'chg.sub': '绿角犀全系产品的版本发布与功能更新，一页尽览。', 'chg.empty': '暂无更新动态', 'chg.noLog': '暂无更新说明', 'chg.loadErr': '加载失败，请刷新重试',
      'csv.contacts': '绿角犀留言', 'csv.products': '绿角犀产品',
      'col.name': '姓名', 'col.email': '邮箱', 'col.message': '留言', 'col.status': '状态',
      'col.time': '时间', 'col.actions': '操作', 'col.category': '分类',
      'status.pending': '待处理', 'status.done': '已处理', 'status.ignored': '已忽略',
      'contact.title': '联系我们', 'contact.sub': '无论是商务合作、产品建议，还是媒体咨询——留下你的信息，我们会尽快回复。',
      'contact.name': '称呼', 'contact.email': '邮箱', 'contact.msg': '想说点什么',
      'contact.namePh': '你的名字', 'contact.emailPh': 'you@example.com', 'contact.msgPh': '想说的话…',
      'contact.other': '其他联系方式', 'contact.slogan': '应用与游戏，触手可及',
      'panel.pageViews': '各页面浏览量', 'panel.sources': '流量来源构成', 'panel.referrers': '主要引荐域名 TOP',
      'panel.langDist': '访问语言分布', 'panel.tzDist': '访问时区分布（地域粗分）', 'panel.browserDist': '浏览器分布', 'panel.osDist': '操作系统分布', 'panel.topDownloads': '热门下载 TOP',
      'panel.security': '账户安全', 'panel.sysinfo': '系统信息',
      'chips.all': '全部', 'chips.new': '未处理', 'chips.done': '已处理',
      'search.contact': '搜索姓名 / 邮箱 / 留言…', 'search.product': '搜索产品名称…', 'search.audit': '搜索操作 / 详情 / IP…',
      'f.name': '名称 *', 'f.type': '类型 *', 'f.category': '分类', 'f.icon': '图标(emoji)', 'f.image': '产品图', 'f.imagePh': 'https://… 或 /assets/img/products/xx.jpg（留空用 emoji）', 'f.upload': '⬆ 上传图片', 'f.sort': '排序权重', 'f.sortPh': '越大越靠前（默认 0）', 'f.url': '下载链接', 'f.desc': '简介', 'f.version': '版本号', 'f.versionPh': '如 1.2.0', 'f.changelog': '更新日志', 'f.changelogPh': '每行一条，格式自由，如：v1.2.0 · 2026-08-20', 'pd.changelog': '更新日志', 'pd.downloads': '次下载', 'pd.related': '相关推荐', 'hot.title': '热门下载', 'hot.sub': '大家正在下载的应用与游戏。', 'hot.empty': '暂无热门数据', 'sort.default': '默认排序', 'sort.new': '最新上架', 'sort.hot': '下载量', 'sort.name': '名称',
      'btn.addProduct': '上架新产品', 'btn.cancelEdit': '取消编辑',
      'pw.current': '当前口令', 'pw.new': '新口令（至少 6 位）', 'pw.confirm': '确认新口令', 'btn.updatePw': '更新口令',
      'na.user': '用户名', 'na.pass': '口令（至少 6 位）', 'na.role': '角色', 'btn.addAccount': '添加账号',
      'btn.exportCsv': '⬇ 导出 CSV', 'btn.exportAudit': '⬇ 导出审计 CSV', 'btn.importCsv': '⬆ 导入 CSV', 'import.ok': '已导入 {n} 条产品', 'btn.backupDb': '⬇ 备份数据库', 'btn.refreshAudit': '↻ 刷新',
      'panel.categories': '产品分类管理', 'cat.none': '（不分类）', 'cat.name': '分类名称', 'cat.add': '新增分类', 'cat.usage': '使用产品', 'cat.rename': '重命名', 'cat.delete': '删除', 'cat.delTitle': '删除分类', 'cat.confirmDel': '确定删除分类「{name}」？该操作不可撤销。', 'cat.save': '保存', 'cat.empty': '暂无分类，请先新增。', 'cat.needName': '请填写分类名称', 'panel.announcements': '前台公告条', 'ann.content': '公告内容（前台顶部横幅，≤200 字符）', 'ann.add': '发布公告', 'ann.empty': '暂无公告。发布后将在全站前台顶部横幅展示。', 'ann.delete': '删除', 'ann.delTitle': '删除公告', 'ann.confirmDel': '确定删除该公告「{content}」？', 'ann.needContent': '公告内容不能为空', 'ann.added': '公告已发布',
      'col.id': 'ID', 'col.type': '类型', 'col.downloads': '下载量', 'col.sort': '排序', 'col.version': '版本', 'empty.products': '暂无产品'
    },
    en: {
      'nav.home': 'Home', 'nav.company': 'Company', 'nav.apps': 'Apps', 'nav.games': 'Games',
      'nav.contact': 'Contact', 'nav.download': 'Download', 'nav.admin': 'Admin', 'nav.api': 'API', 'nav.changelog': 'Updates',
      'nav.toggleTheme': 'Toggle theme', 'nav.searchPh': 'Search products…', 'nav.searchInput': 'Search products', 'nav.searchBtn': 'Search', 'nav.searchForm': 'Site search', 'nav.menu': 'Open menu',
      'footer.copy': '© 2026 Green Rhino LVJIAOXI · Apps & Games within reach',
      'footer.home': 'Home', 'footer.contact': 'Contact', 'footer.api': 'API Docs', 'footer.admin': 'Admin',
      'footer.privacy': 'Privacy Policy', 'footer.terms': 'Terms of Service',
      'legal.privacyTitle': 'Privacy Policy', 'legal.privacySub': 'We value your privacy. This policy explains what information we collect, how it is used and protected, and your rights.',
      'legal.termsTitle': 'Terms of Service', 'legal.termsSub': 'Please read and agree to these terms before using this website and downloading products.',
      'btn.refresh': '↻ Refresh', 'btn.autoOff': 'Auto off', 'btn.autoOn': 'Auto on', 'btn.checkUpdate': '↻ Check for updates',
      'btn.logout': 'Log out', 'btn.login': 'Log in',
      'btn.backHome': 'Back home', 'btn.retry': 'Retry', 'btn.download': 'Download', 'btn.submit': 'Send message', 'btn.sending': 'Sending…',
      'err.quickNav': 'Quick links', 'err.search': 'Site search', 'err.searchPh': 'Search products…', 'err.searchEmpty': 'No matching products', 'err.searchOffline': 'Search needs a connection — try again when back online', 'err.matchCat': 'Category', 'err.matchType': 'Type', 'err.matchDesc': 'Description',
      'pwa.update': 'A new version is available. Refresh to update.', 'pwa.refresh': 'Refresh', 'pwa.close': 'Close',
      'readonly.banner': 'You are in read-only (viewer) mode. Write actions are disabled.',
      'login.title': 'Green Rhino Admin', 'login.sub': 'Sign in with an admin account',
      'login.user': 'Username', 'login.pass': 'Password',
      'login.userPh': 'default: admin', 'login.passPh': 'default: admin123',
      'login.err': 'Wrong username or password', 'login.back': '← Back to site',
      'dash.title': 'Dashboard', 'role.admin': 'Admin', 'role.viewer': 'Viewer',
      'panel.trend': 'Traffic Trend', 'trend.days': 'Last {n} days', 'trend.dayUnit': 'd', 'trend.total': 'Period total: {v} views · {d} downloads', 'legend.views': 'Views', 'legend.downloads': 'Downloads',
      'panel.products': 'Products', 'panel.contacts': 'Messages', 'panel.audit': 'Audit Log',
      'panel.accesslog': 'Access Log', 'panel.admins': 'Administrators',
      'admin.self': 'You', 'admin.delete': 'Delete', 'admin.roleTitle': 'Change Role', 'admin.roleConfirm': 'Change "{name}"\'s role to "{role}"?', 'admin.confirm': 'Confirm', 'admin.deleteTitle': 'Delete Account', 'admin.deleteConfirm': 'Delete account "{name}"? This cannot be undone.',
      'kpi.views': 'Total views', 'kpi.downloads': 'Total downloads', 'kpi.products': 'Live products',
      'kpi.contacts': 'Messages', 'kpi.pending': 'Pending', 'kpi.today': "Today's views",
      'kpi.monitored': 'Pages monitored', 'kpi.productCount': 'Products',
      'status.on': 'Live', 'status.off': 'Offline', 'status.markPending': 'Mark pending', 'status.markDone': 'Mark done',
      'type.app': 'App', 'type.game': 'Game', 'empty.none': 'No data', 'empty.referrers': 'No referrers',
      'product.edit': 'Edit', 'product.delete': 'Delete', 'contact.reply': 'Reply', 'contact.delete': 'Delete', 'contact.deleteTitle': 'Delete Message', 'contact.deleteConfirm': 'Delete this message? This cannot be undone.', 'contact.selectAll': 'Select page', 'contact.markDoneSel': 'Mark done', 'contact.delSel': 'Delete selected', 'contact.batchCount': '{n} selected', 'contact.delSelTitle': 'Delete Messages', 'contact.delSelConfirm': 'Delete the {n} selected messages? This cannot be undone.', 'product.deleteTitle': 'Delete Product', 'product.deleteConfirm': 'Delete product "{name}"? This cannot be undone.',
      'action.shelfOn': 'Publish', 'action.shelfOff': 'Unpublish',
      'bulk.selectAll': 'Select all', 'bulk.batchCount': '{n} products selected', 'bulk.shelfOn': 'Bulk Publish', 'bulk.shelfOff': 'Bulk Unpublish', 'bulk.category': 'Set category', 'bulk.del': 'Delete selected', 'bulk.delTitle': 'Delete Products', 'bulk.delConfirm': 'Delete the {n} selected products? This cannot be undone.', 'bulk.done': 'Success', 'bulk.fail': 'Bulk operation failed: ', 'bulk.needSel': 'Select products first',
      'panel.maintenance': 'Site Maintenance', 'maint.desc': 'When enabled, front-end pages and public APIs will return maintenance messages (backend and static resources are unaffected).', 'maint.msg': 'Maintenance message (optional, displayed on maintenance page, ≤200 characters)', 'maint.on': 'Enable Maintenance', 'maint.off': 'Disable Maintenance', 'maint.statusOn': 'Maintenance Active', 'maint.statusOff': 'Normal Operation', 'maint.confirmTitle': 'Confirm Enable Maintenance', 'maint.confirm': 'After enabling, regular visitors cannot access the front-end; only administrators can log in via the backend entrance.', 'maint.done': 'Operation successful',
      'panel.feedback': 'Product Feedback', 'fb.filterProduct': 'All products', 'fb.empty': 'No feedback yet', 'fb.unrated': 'Unrated', 'fb.markDone': 'Mark as processed', 'fb.markPending': 'Reopen', 'fb.delTitle': 'Delete feedback', 'fb.delConfirm': 'Delete this feedback? This cannot be undone.', 'fb.title': 'User Feedback', 'fb.sub': 'Tell us about your experience with this product (rating optional)', 'fb.rate': 'Rating (optional)', 'fb.namePh': 'Your name (optional)', 'fb.content': 'Feedback *', 'fb.contentPh': 'Experience, suggestions or issues…', 'fb.submit': 'Submit', 'fb.sending': 'Submitting…', 'fb.ok': 'Thanks for your feedback!', 'fb.err': 'Submission failed, please try again later', 'fb.need': 'Please enter your feedback', 'fb.badMail': 'Invalid email format', 'search.feedback': 'Search feedback / name / email…',
      'panel.fbOverview': 'Feedback Overview', 'fb.avgBy': 'Rated by {n} users', 'fb.recent': 'Latest Reviews', 'fb.anon': 'Anonymous', 'fb.byProduct': 'By Product', 'fb.week7': 'Last 7 Days', 'kpi.fbTotal': 'Total Feedback', 'kpi.fbPending': 'Pending', 'kpi.fbRated': 'Rated', 'kpi.fbAvg': 'Avg Rating', 'btn.exportStats': 'Export Analysis CSV', 'chg.title': 'Product Updates', 'chg.sub': 'All product releases and updates in one place.', 'chg.empty': 'No updates yet', 'chg.noLog': 'No release notes', 'chg.loadErr': 'Failed to load, please refresh',
      'csv.contacts': 'LVJIAOXI Messages', 'csv.products': 'LVJIAOXI Products',
      'col.name': 'Name', 'col.email': 'Email', 'col.message': 'Message', 'col.status': 'Status',
      'col.time': 'Time', 'col.actions': 'Actions', 'col.category': 'Category',
      'status.pending': 'Pending', 'status.done': 'Done', 'status.ignored': 'Ignored',
      'contact.title': 'Contact Us', 'contact.sub': 'Whether it is partnership, product feedback, or media inquiry — leave a note and we will reply soon.',
      'contact.name': 'Name', 'contact.email': 'Email', 'contact.msg': 'Message',
      'contact.namePh': 'Your name', 'contact.emailPh': 'you@example.com', 'contact.msgPh': 'Say something…',
      'contact.other': 'Other contacts', 'contact.slogan': 'Apps & Games within reach',
      'panel.pageViews': 'Page views', 'panel.sources': 'Traffic sources', 'panel.referrers': 'Top referrers',
      'panel.langDist': 'Language distribution', 'panel.tzDist': 'Timezone distribution', 'panel.browserDist': 'Browser distribution', 'panel.osDist': 'OS distribution', 'panel.topDownloads': 'Top downloads',
      'panel.security': 'Account security', 'panel.sysinfo': 'System info',
      'chips.all': 'All', 'chips.new': 'Pending', 'chips.done': 'Done',
      'search.contact': 'Search name / email / message…', 'search.product': 'Search products…', 'search.audit': 'Search action / detail / IP…',
      'f.name': 'Name *', 'f.type': 'Type *', 'f.category': 'Category', 'f.icon': 'Icon (emoji)', 'f.image': 'Product image', 'f.imagePh': 'https://… or /assets/img/products/xx.jpg (blank = emoji)', 'f.upload': '⬆ Upload image', 'f.sort': 'Sort weight', 'f.sortPh': 'Larger = higher (default 0)', 'f.url': 'Download URL', 'f.desc': 'Description', 'f.version': 'Version', 'f.versionPh': 'e.g. 1.2.0', 'f.changelog': 'Changelog', 'f.changelogPh': 'One entry per line, free format, e.g.: v1.2.0 · 2026-08-20', 'pd.changelog': 'Changelog', 'pd.downloads': 'downloads', 'pd.related': 'Related', 'hot.title': 'Popular Downloads', 'hot.sub': 'Apps & games people are downloading.', 'hot.empty': 'No popular items yet', 'sort.default': 'Default', 'sort.new': 'Newest', 'sort.hot': 'Downloads', 'sort.name': 'Name',
      'btn.addProduct': 'Add product', 'btn.cancelEdit': 'Cancel',
      'pw.current': 'Current password', 'pw.new': 'New password (min 6)', 'pw.confirm': 'Confirm password', 'btn.updatePw': 'Update password',
      'na.user': 'Username', 'na.pass': 'Password (min 6)', 'na.role': 'Role', 'btn.addAccount': 'Add account',
      'btn.exportCsv': '⬇ Export CSV', 'btn.exportAudit': '⬇ Export Audit', 'btn.importCsv': '⬆ Import CSV', 'import.ok': 'Imported {n} products', 'btn.backupDb': '⬇ Backup DB', 'btn.refreshAudit': '↻ Refresh',
      'panel.categories': 'Category Management', 'cat.none': '(No category)', 'cat.name': 'Category Name', 'cat.add': 'Add Category', 'cat.usage': 'Used By', 'cat.rename': 'Rename', 'cat.delete': 'Delete', 'cat.delTitle': 'Delete Category', 'cat.confirmDel': 'Delete category "{name}"? This cannot be undone.', 'cat.save': 'Save', 'cat.empty': 'No categories yet. Add one first.', 'cat.needName': 'Please enter a category name', 'panel.announcements': 'Announcement Bar', 'ann.content': 'Announcement (top banner, ≤200 chars)', 'ann.add': 'Publish', 'ann.empty': 'No announcements yet. Published ones appear in the top banner site-wide.', 'ann.delete': 'Delete', 'ann.delTitle': 'Delete Announcement', 'ann.confirmDel': 'Delete this announcement "{content}"?', 'ann.needContent': 'Announcement cannot be empty', 'ann.added': 'Announcement published',
      'col.id': 'ID', 'col.type': 'Type', 'col.downloads': 'Downloads', 'col.sort': 'Sort', 'col.version': 'Version', 'empty.products': 'No products'
    },
    ja: {
      'nav.home': 'ホーム', 'nav.company': '会社', 'nav.apps': 'アプリ', 'nav.games': 'ゲーム',
      'nav.contact': 'お問い合わせ', 'nav.download': 'ダウンロード', 'nav.admin': '管理', 'nav.api': 'API', 'nav.changelog': '更新情報',
      'nav.toggleTheme': 'テーマ切替', 'nav.searchPh': '製品を検索…', 'nav.searchInput': '製品を検索', 'nav.searchBtn': '検索', 'nav.searchForm': 'サイト内検索', 'nav.menu': 'メニューを開く',
      'footer.copy': '© 2026 緑角犀 LVJIAOXI · アプリとゲーム、手の届くところに',
      'footer.home': 'ホーム', 'footer.contact': 'お問い合わせ', 'footer.api': 'API', 'footer.admin': '管理',
      'footer.privacy': 'プライバシーポリシー', 'footer.terms': '利用規約',
      'legal.privacyTitle': 'プライバシーポリシー', 'legal.privacySub': '当社はお客様のプライバシーを大切にします。本ポリシーは、収集する情報、その利用・保護方法、およびお客様の権利について説明します。',
      'legal.termsTitle': '利用規約', 'legal.termsSub': '本ウェブサイトの利用および製品のダウンロード前に、以下の規約をお読みいただき同意してください。',
      'btn.refresh': '↻ データ更新', 'btn.autoOff': '自動更新 オフ', 'btn.autoOn': '自動更新 オン', 'btn.checkUpdate': '↻ 更新を確認',
      'btn.logout': 'ログアウト', 'btn.login': 'ログイン',
      'btn.backHome': 'ホームへ', 'btn.retry': '再試行', 'btn.download': 'ダウンロード', 'btn.submit': 'メッセージ送信', 'btn.sending': '送信中…',
      'err.quickNav': 'クイックリンク', 'err.search': 'サイト内検索', 'err.searchPh': '製品名で検索…', 'err.searchEmpty': '一致する製品はありません', 'err.searchOffline': '検索には接続が必要です。オンラインになってから再試行してください', 'err.matchCat': 'カテゴリ', 'err.matchType': 'タイプ', 'err.matchDesc': '説明',
      'pwa.update': '新しいバージョンがあります。更新するには再読み込みしてください。', 'pwa.refresh': '再読み込み', 'pwa.close': '閉じる',
      'readonly.banner': '現在は読み取り専用（viewer）アカウントです。データ閲覧のみで、書き込みは無効です。',
      'login.title': '緑角犀 管理', 'login.sub': '管理者アカウントを入力',
      'login.user': 'ユーザー名', 'login.pass': 'パスワード',
      'login.userPh': 'デフォルト: admin', 'login.passPh': 'デフォルト: admin123',
      'login.err': 'アカウントまたはパスワードが違います', 'login.back': '← サイトへ戻る',
      'dash.title': 'ダッシュボード', 'role.admin': '管理者', 'role.viewer': '閲覧専用',
      'panel.trend': 'トラフィック推移', 'trend.days': '直近{n}日', 'trend.dayUnit': '日', 'trend.total': '期間合計：閲覧 {v} 回 · ダウンロード {d} 回', 'legend.views': '閲覧数', 'legend.downloads': 'ダウンロード数',
      'panel.products': '製品管理', 'panel.contacts': 'お問い合わせ', 'panel.audit': '操作監査ログ',
      'panel.accesslog': 'アクセスログ', 'panel.admins': '管理者管理',
      'admin.self': '現在のアカウント', 'admin.delete': '削除', 'admin.roleTitle': '役割変更', 'admin.roleConfirm': '「{name}」の役割を「{role}」に変更しますか？', 'admin.confirm': '確認', 'admin.deleteTitle': 'アカウント削除', 'admin.deleteConfirm': 'アカウント「{name}」を削除しますか？この操作は取り消せません。',
      'kpi.views': '総閲覧数', 'kpi.downloads': '総ダウンロード数', 'kpi.products': '公開製品',
      'kpi.contacts': 'お問い合わせ', 'kpi.pending': '未対応', 'kpi.today': '本日の閲覧',
      'kpi.monitored': '監視ページ', 'kpi.productCount': '製品数',
      'status.on': '公開中', 'status.off': '非公開', 'status.markPending': '未対応にする', 'status.markDone': '対応済にする',
      'type.app': 'アプリ', 'type.game': 'ゲーム', 'empty.none': 'データなし', 'empty.referrers': '参照元なし',
      'product.edit': '編集', 'product.delete': '削除', 'contact.reply': '返信', 'contact.delete': '削除', 'contact.deleteTitle': 'メッセージを削除', 'contact.deleteConfirm': 'このメッセージを削除しますか？元に戻せません。', 'contact.selectAll': 'このページを全選択', 'contact.markDoneSel': '対応済にする', 'contact.delSel': '選択を削除', 'contact.batchCount': '{n} 件選択中', 'contact.delSelTitle': 'メッセージを一括削除', 'contact.delSelConfirm': '選択した {n} 件のメッセージを削除しますか？元に戻せません。', 'product.deleteTitle': '製品を削除', 'product.deleteConfirm': '製品「{name}」を削除しますか？元に戻せません。',
      'action.shelfOn': '公開する', 'action.shelfOff': '非公開にする',
      'bulk.selectAll': '全選択', 'bulk.batchCount': '{n} 件の製品を選択中', 'bulk.shelfOn': '一括公開', 'bulk.shelfOff': '一括非公開', 'bulk.category': '一括カテゴリ変更', 'bulk.del': '選択を削除', 'bulk.delTitle': '製品を一括削除', 'bulk.delConfirm': '選択した {n} 件の製品を削除しますか？元に戻せません。', 'bulk.done': '操作成功', 'bulk.fail': '一括操作に失敗：', 'bulk.needSel': '製品を選択してください',
      'panel.maintenance': 'サイトメンテナンス', 'maint.desc': '有効にすると、フロントエンドのページと公開 API はメンテナンス通知を返します（バックエンドと静的リソースは影響を受けません）。', 'maint.msg': 'メンテナンスメッセージ（任意、メンテナンスページに表示、≤200 文字）', 'maint.on': 'メンテナンス開始', 'maint.off': 'メンテナンス終了', 'maint.statusOn': 'メンテナンス中', 'maint.statusOff': '正常稼働中', 'maint.confirmTitle': 'メンテナンス開始の確認', 'maint.confirm': '開始後、一般の訪問者はフロントエンドにアクセスできなくなります。管理者のみバックエンドからログインできます。', 'maint.done': '操作成功',
      'panel.feedback': '製品フィードバック', 'fb.filterProduct': 'すべての製品', 'fb.empty': 'フィードバックはまだありません', 'fb.unrated': '未評価', 'fb.markDone': '対応済みにする', 'fb.markPending': '再開', 'fb.delTitle': 'フィードバックを削除', 'fb.delConfirm': 'このフィードバックを削除しますか？元に戻せません。', 'fb.title': 'ユーザーフィードバック', 'fb.sub': 'この製品の使用感をお聞かせください（評価は任意）', 'fb.rate': '評価（任意）', 'fb.namePh': 'お名前（任意）', 'fb.content': 'フィードバック *', 'fb.contentPh': '使用感、ご提案、問題点など…', 'fb.submit': '送信', 'fb.sending': '送信中…', 'fb.ok': 'フィードバックありがとうございます！', 'fb.err': '送信に失敗しました。後でもう一度お試しください', 'fb.need': 'フィードバックを入力してください', 'fb.badMail': 'メール形式が正しくありません', 'search.feedback': 'フィードバック・名前・メールを検索…',
      'panel.fbOverview': 'フィードバック概要', 'fb.avgBy': '{n} 人が評価', 'fb.recent': '最新の評価', 'fb.anon': '匿名ユーザー', 'fb.byProduct': '製品別分布', 'fb.week7': '直近7日の新規', 'kpi.fbTotal': 'フィードバック総数', 'kpi.fbPending': '未処理', 'kpi.fbRated': '評価済み', 'kpi.fbAvg': '平均点', 'btn.exportStats': '分析CSVをエクスポート', 'chg.title': '製品アップデート', 'chg.sub': '全製品のバージョン情報と更新内容をまとめて表示します。', 'chg.empty': '更新情報はまだありません', 'chg.noLog': '更新説明はありません', 'chg.loadErr': '読み込みに失敗しました。再読み込みしてください',
      'csv.contacts': '緑角犀メッセージ', 'csv.products': '緑角犀製品',
      'col.name': '氏名', 'col.email': 'メール', 'col.message': 'メッセージ', 'col.status': 'ステータス',
      'col.time': '日時', 'col.actions': '操作', 'col.category': 'カテゴリ',
      'status.pending': '未対応', 'status.done': '対応済', 'status.ignored': '無視',
      'contact.title': 'お問い合わせ', 'contact.sub': '事業提携、製品へのご意見、メディアのお問い合わせなど——ご連絡いただければ速やかに返信します。',
      'contact.name': 'お名前', 'contact.email': 'メール', 'contact.msg': 'メッセージ',
      'contact.namePh': 'お名前', 'contact.emailPh': 'you@example.com', 'contact.msgPh': 'メッセージをどうぞ…',
      'contact.other': 'その他の連絡先', 'contact.slogan': 'アプリとゲーム、手の届くところに',
      'panel.pageViews': 'ページ別閲覧数', 'panel.sources': 'トラフィック源', 'panel.referrers': '主な参照ドメイン TOP',
      'panel.langDist': '閲覧言語分布', 'panel.tzDist': '閲覧タイムゾーン分布（地域概算）', 'panel.browserDist': 'ブラウザ分布', 'panel.osDist': 'OS分布', 'panel.topDownloads': '人気ダウンロード TOP',
      'panel.security': 'アカウントのセキュリティ', 'panel.sysinfo': 'システム情報',
      'chips.all': 'すべて', 'chips.new': '未対応', 'chips.done': '対応済',
      'search.contact': '氏名・メール・メッセージで検索…', 'search.product': '製品名で検索…', 'search.audit': '操作・詳細・IPで検索…',
      'f.name': '名前 *', 'f.type': '種別 *', 'f.category': 'カテゴリ', 'f.icon': 'アイコン(emoji)', 'f.image': '商品画像', 'f.imagePh': 'https://… または /assets/img/products/xx.jpg（空欄は絵文字）', 'f.upload': '⬆ 画像をアップロード', 'f.sort': '並び順', 'f.sortPh': '大きいほど先頭（初期値 0）', 'f.url': 'ダウンロードURL', 'f.desc': '説明', 'f.version': 'バージョン', 'f.versionPh': '例：1.2.0', 'f.changelog': 'アップデート情報', 'f.changelogPh': '1行に1件、形式は自由（例：v1.2.0 · 2026-08-20）', 'pd.changelog': 'アップデート情報', 'pd.downloads': 'ダウンロード回数', 'pd.related': '関連商品', 'hot.title': '人気ダウンロード', 'hot.sub': 'みんながダウンロードしているアプリとゲーム。', 'hot.empty': '人気データはまだありません', 'sort.default': '既定の順序', 'sort.new': '新着順', 'sort.hot': 'ダウンロード数', 'sort.name': '名前順',
      'btn.addProduct': '新規公開', 'btn.cancelEdit': '編集キャンセル',
      'pw.current': '現在のパスワード', 'pw.new': '新しいパスワード（6文字以上）', 'pw.confirm': 'パスワード（確認）', 'btn.updatePw': 'パスワード更新',
      'na.user': 'ユーザー名', 'na.pass': 'パスワード（6文字以上）', 'na.role': '権限', 'btn.addAccount': 'アカウント追加',
      'btn.exportCsv': '⬇ CSV出力', 'btn.exportAudit': '⬇ 監査CSV出力', 'btn.importCsv': '⬆ CSV一括インポート', 'import.ok': '{n} 件の製品をインポートしました', 'btn.backupDb': '⬇ DBバックアップ', 'btn.refreshAudit': '↻ 更新',
      'panel.categories': 'カテゴリ管理', 'cat.none': '（分類なし）', 'cat.name': 'カテゴリ名', 'cat.add': 'カテゴリ追加', 'cat.usage': '使用中', 'cat.rename': '名前を変更', 'cat.delete': '削除', 'cat.delTitle': 'カテゴリ削除', 'cat.confirmDel': 'カテゴリ「{name}」を削除しますか？この操作は元に戻せません。', 'cat.save': '保存', 'cat.empty': 'カテゴリがありません。先に追加してください。', 'cat.needName': 'カテゴリ名を入力してください', 'panel.announcements': 'お知らせバー', 'ann.content': 'お知らせ内容（サイト上部バナー、200文字以内）', 'ann.add': '公開する', 'ann.empty': 'お知らせはありません。公開すると全ページ上部にバナー表示されます。', 'ann.delete': '削除', 'ann.delTitle': 'お知らせ削除', 'ann.confirmDel': 'お知らせ「{content}」を削除しますか？', 'ann.needContent': 'お知らせ内容を入力してください', 'ann.added': 'お知らせを公開しました',
      'col.id': 'ID', 'col.type': '種別', 'col.downloads': 'ダウンロード数', 'col.sort': '並び順', 'col.version': 'バージョン', 'empty.products': '製品なし'
    },
    ko: {
      'nav.home': '홈', 'nav.company': '회사', 'nav.apps': '앱', 'nav.games': '게임',
      'nav.contact': '문의', 'nav.download': '다운로드', 'nav.admin': '관리', 'nav.api': 'API', 'nav.changelog': '업데이트',
      'nav.toggleTheme': '테마 전환', 'nav.searchPh': '제품 검색…', 'nav.searchInput': '제품 검색', 'nav.searchBtn': '검색', 'nav.searchForm': '사이트 검색', 'nav.menu': '메뉴 열기',
      'footer.copy': '© 2026 녹각희 LVJIAOXI · 앱과 게임, 손끝에서',
      'footer.home': '홈', 'footer.contact': '문의하기', 'footer.api': 'API', 'footer.admin': '관리',
      'footer.privacy': '개인정보 처리방침', 'footer.terms': '이용약관',
      'legal.privacyTitle': '개인정보 처리방침', 'legal.privacySub': '당사는 귀하의 개인정보를 중요하게 생각합니다. 본 방침은 수집하는 정보, 이용·보호 방법 및 귀하의 권리에 대해 설명합니다.',
      'legal.termsTitle': '이용약관', 'legal.termsSub': '본 웹사이트 이용 및 제품 다운로드 전에 아래 약관을 읽고 동의해 주세요.',
      'btn.refresh': '↻ 새로고침', 'btn.autoOff': '자동 새로고침 끄기', 'btn.autoOn': '자동 새로고침 켜기', 'btn.checkUpdate': '↻ 업데이트 확인',
      'btn.logout': '로그아웃', 'btn.login': '로그인',
      'btn.backHome': '홈으로', 'btn.retry': '다시 시도', 'btn.download': '다운로드', 'btn.submit': '메시지 보내기', 'btn.sending': '전송 중…',
      'err.quickNav': '빠른 링크', 'err.search': '사이트 검색', 'err.searchPh': '제품명으로 검색…', 'err.searchEmpty': '일치하는 제품이 없습니다', 'err.searchOffline': '검색하려면 연결이 필요합니다. 온라인 상태에서 다시 시도하세요', 'err.matchCat': '카테고리', 'err.matchType': '유형', 'err.matchDesc': '설명',
      'pwa.update': '새 버전이 있습니다. 새로고침하여 업데이트하세요.', 'pwa.refresh': '새로고침', 'pwa.close': '닫기',
      'readonly.banner': '현재 읽기 전용(viewer) 계정입니다. 데이터 보기만 가능하고 쓰기 작업은 비활성화되어 있습니다.',
      'login.title': '녹각희 관리', 'login.sub': '관리자 계정을 입력하세요',
      'login.user': '사용자명', 'login.pass': '비밀번호',
      'login.userPh': '기본: admin', 'login.passPh': '기본: admin123',
      'login.err': '계정 또는 비밀번호 오류', 'login.back': '← 사이트로 돌아가기',
      'dash.title': '대시보드', 'role.admin': '관리자', 'role.viewer': '읽기 전용',
      'panel.trend': '트래픽 추이', 'trend.days': '최근 {n}일', 'trend.dayUnit': '일', 'trend.total': '기간 합계: 조회 {v}회 · 다운로드 {d}회', 'legend.views': '조회수', 'legend.downloads': '다운로드 수',
      'panel.products': '제품 관리', 'panel.contacts': '문의 메시지', 'panel.audit': '작업 감사 로그',
      'panel.accesslog': '접속 로그', 'panel.admins': '계정 관리',
      'admin.self': '현재 계정', 'admin.delete': '삭제', 'admin.roleTitle': '역할 변경', 'admin.roleConfirm': '"{name}"의 역할을 "{role}"(으)로 변경하시겠습니까?', 'admin.confirm': '확인', 'admin.deleteTitle': '계정 삭제', 'admin.deleteConfirm': '계정 "{name}"을(를) 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.',
      'kpi.views': '총 조회수', 'kpi.downloads': '총 다운로드 수', 'kpi.products': '게시 제품',
      'kpi.contacts': '문의', 'kpi.pending': '미처리', 'kpi.today': '오늘 조회',
      'kpi.monitored': '모니터링 페이지', 'kpi.productCount': '제품 수',
      'status.on': '게시됨', 'status.off': '비공개', 'status.markPending': '미처리로 표시', 'status.markDone': '처리완료로 표시',
      'type.app': '앱', 'type.game': '게임', 'empty.none': '데이터 없음', 'empty.referrers': '추천 데이터 없음',
      'product.edit': '편집', 'product.delete': '삭제', 'contact.reply': '답장', 'contact.delete': '삭제', 'contact.deleteTitle': '메시지 삭제', 'contact.deleteConfirm': '이 메시지를 삭제할까요? 되돌릴 수 없습니다.', 'contact.selectAll': '이 페이지 전체 선택', 'contact.markDoneSel': '처리완료로 표시', 'contact.delSel': '선택 삭제', 'contact.batchCount': '{n}개 선택됨', 'contact.delSelTitle': '메시지 일괄 삭제', 'contact.delSelConfirm': '선택한 {n}개의 메시지를 삭제할까요? 되돌릴 수 없습니다.', 'product.deleteTitle': '제품 삭제', 'product.deleteConfirm': '제품 「{name}」을(를) 삭제할까요? 되돌릴 수 없습니다.',
      'action.shelfOn': '게시', 'action.shelfOff': '게시 해제',
      'bulk.selectAll': '전체 선택', 'bulk.batchCount': '제품 {n}개 선택됨', 'bulk.shelfOn': '일괄 게시', 'bulk.shelfOff': '일괄 게시 해제', 'bulk.category': '일괄 카테고리 변경', 'bulk.del': '선택 삭제', 'bulk.delTitle': '제품 일괄 삭제', 'bulk.delConfirm': '선택한 {n}개의 제품을 삭제할까요? 되돌릴 수 없습니다.', 'bulk.done': '작업 성공', 'bulk.fail': '일괄 작업 실패：', 'bulk.needSel': '제품을 먼저 선택하세요',
      'panel.maintenance': '사이트 유지보수', 'maint.desc': '활성화하면 프론트엔드 페이지와 공개 API가 유지보수 알림을 반환합니다(백엔드와 정적 리소스는 영향 없음).', 'maint.msg': '유지보수 메시지(선택 사항, 유지보수 페이지에 표시, ≤200자)', 'maint.on': '유지보수 시작', 'maint.off': '유지보수 종료', 'maint.statusOn': '유지보수 중', 'maint.statusOff': '정상 운영', 'maint.confirmTitle': '유지보수 시작 확인', 'maint.confirm': '시작 후 일반 방문자는 프론트엔드에 접근할 수 없으며 관리자만 백엔드로 로그인할 수 있습니다.', 'maint.done': '작업 성공',
      'panel.feedback': '제품 피드백', 'fb.filterProduct': '모든 제품', 'fb.empty': '피드백이 없습니다', 'fb.unrated': '평가 없음', 'fb.markDone': '처리됨으로 표시', 'fb.markPending': '다시 열기', 'fb.delTitle': '피드백 삭제', 'fb.delConfirm': '이 피드백을 삭제할까요? 되돌릴 수 없습니다.', 'fb.title': '사용자 피드백', 'fb.sub': '이 제품의 사용 경험을 알려주세요(평가 선택 사항)', 'fb.rate': '평가(선택 사항)', 'fb.namePh': '이름(선택 사항)', 'fb.content': '피드백 *', 'fb.contentPh': '사용 경험, 제안 또는 문제…', 'fb.submit': '제출', 'fb.sending': '제출 중…', 'fb.ok': '피드백 감사합니다!', 'fb.err': '제출에 실패했습니다. 나중에 다시 시도하세요', 'fb.need': '피드백을 입력하세요', 'fb.badMail': '이메일 형식이 올바르지 않습니다', 'search.feedback': '피드백/이름/이메일 검색…',
      'panel.fbOverview': '피드백 개요', 'fb.avgBy': '{n}명 평가', 'fb.recent': '최신 평가', 'fb.anon': '익명 사용자', 'fb.byProduct': '제품별 분포', 'fb.week7': '최근 7일 추이', 'kpi.fbTotal': '피드백 총계', 'kpi.fbPending': '미처리', 'kpi.fbRated': '평가됨', 'kpi.fbAvg': '평균 평점', 'btn.exportStats': '분석 CSV 내보내기', 'chg.title': '제품 업데이트', 'chg.sub': '모든 제품의 버전 출시와 기능 업데이트를 한눈에 확인하세요.', 'chg.empty': '아직 업데이트가 없습니다', 'chg.noLog': '업데이트 설명 없음', 'chg.loadErr': '로드 실패, 새로고침하세요',
      'csv.contacts': '녹각희 문의', 'csv.products': '녹각희 제품',
      'col.name': '이름', 'col.email': '이메일', 'col.message': '메시지', 'col.status': '상태',
      'col.time': '시간', 'col.actions': '작업', 'col.category': '분류',
      'status.pending': '대기', 'status.done': '처리완료', 'status.ignored': '무시됨',
      'contact.title': '문의하기', 'contact.sub': '비즈니스 제휴, 제품 제안, 미디어 문의 등 무엇이든 남겨주시면 최대한 빨리 답변드리겠습니다.',
      'contact.name': '이름', 'contact.email': '이메일', 'contact.msg': '메시지',
      'contact.namePh': '이름', 'contact.emailPh': 'you@example.com', 'contact.msgPh': '하고 싶은 말…',
      'contact.other': '기타 연락처', 'contact.slogan': '앱과 게임, 손끝에서',
      'panel.pageViews': '페이지별 조회수', 'panel.sources': '트래픽 출처', 'panel.referrers': '주요 유입 도메인 TOP',
      'panel.langDist': '방문 언어 분포', 'panel.tzDist': '방문 시간대 분포(지역 개략)', 'panel.browserDist': '브라우저 분포', 'panel.osDist': '운영체제 분포', 'panel.topDownloads': '인기 다운로드 TOP',
      'panel.security': '계정 보안', 'panel.sysinfo': '시스템 정보',
      'chips.all': '전체', 'chips.new': '미처리', 'chips.done': '처리완료',
      'search.contact': '이름/이메일/메시지 검색…', 'search.product': '제품명 검색…', 'search.audit': '작업·상세·IP 검색…',
      'f.name': '이름 *', 'f.type': '유형 *', 'f.category': '분류', 'f.icon': '아이콘(emoji)', 'f.image': '제품 이미지', 'f.imagePh': 'https://… 또는 /assets/img/products/xx.jpg（비우면 이모지）', 'f.upload': '⬆ 이미지 업로드', 'f.sort': '정렬 가중치', 'f.sortPh': '클수록 앞에 표시(기본 0)', 'f.url': '다운로드 링크', 'f.desc': '설명', 'f.version': '버전', 'f.versionPh': '예: 1.2.0', 'f.changelog': '업데이트 로그', 'f.changelogPh': '한 줄에 한 항목, 형식 자유 (예: v1.2.0 · 2026-08-20)', 'pd.changelog': '업데이트 로그', 'pd.downloads': '다운로드', 'pd.related': '관련 상품', 'hot.title': '인기 다운로드', 'hot.sub': '지금 인기 있는 앱과 게임.', 'hot.empty': '인기 데이터가 없습니다', 'sort.default': '기본 정렬', 'sort.new': '최신 등록', 'sort.hot': '다운로드 수', 'sort.name': '이름순',
      'btn.addProduct': '새 제품 게시', 'btn.cancelEdit': '편집 취소',
      'pw.current': '현재 비밀번호', 'pw.new': '새 비밀번호(최소 6자)', 'pw.confirm': '비밀번호 확인', 'btn.updatePw': '비밀번호 업데이트',
      'na.user': '사용자명', 'na.pass': '비밀번호(최소 6자)', 'na.role': '역할', 'btn.addAccount': '계정 추가',
      'btn.exportCsv': '⬇ CSV 내보내기', 'btn.exportAudit': '⬇ 감사 CSV 내보내기', 'btn.importCsv': '⬆ CSV 가져오기', 'import.ok': '제품 {n}개를 가져왔습니다', 'btn.backupDb': '⬇ DB 백업', 'btn.refreshAudit': '↻ 새로고침',
      'panel.categories': '카테고리 관리', 'cat.none': '(분류 없음)', 'cat.name': '카테고리 이름', 'cat.add': '카테고리 추가', 'cat.usage': '사용 중', 'cat.rename': '이름 바꾸기', 'cat.delete': '삭제', 'cat.delTitle': '카테고리 삭제', 'cat.confirmDel': '카테고리 "{name}"을(를) 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.', 'cat.save': '저장', 'cat.empty': '카테고리가 없습니다. 먼저 추가하세요.', 'cat.needName': '카테고리 이름을 입력하세요', 'panel.announcements': '공지 바', 'ann.content': '공지 내용(사이트 상단 배너, 200자 이내)', 'ann.add': '공지 발행', 'ann.empty': '공지가 없습니다. 발행하면 전 페이지 상단 배너에 표시됩니다.', 'ann.delete': '삭제', 'ann.delTitle': '공지 삭제', 'ann.confirmDel': '공지 "{content}"을(를) 삭제하시겠습니까?', 'ann.needContent': '공지 내용을 입력하세요', 'ann.added': '공지가 발행되었습니다',
      'col.id': 'ID', 'col.type': '유형', 'col.downloads': '다운로드 수', 'col.sort': '정렬', 'col.version': '버전', 'empty.products': '제품 없음'
    },
    es: {
      'nav.home': 'Inicio', 'nav.company': 'Empresa', 'nav.apps': 'Aplicaciones', 'nav.games': 'Juegos',
      'nav.contact': 'Contacto', 'nav.download': 'Descargar', 'nav.admin': 'Admin', 'nav.api': 'API', 'nav.changelog': 'Novedades',
      'nav.toggleTheme': 'Cambiar tema', 'nav.searchPh': 'Buscar productos…', 'nav.searchInput': 'Buscar productos', 'nav.searchBtn': 'Buscar', 'nav.searchForm': 'Buscar en el sitio', 'nav.menu': 'Abrir menú',
      'footer.copy': '© 2026 LVJIAOXI · Apps y juegos al alcance de tu mano',
      'footer.home': 'Inicio', 'footer.contact': 'Contacto', 'footer.api': 'API', 'footer.admin': 'Admin',
      'footer.privacy': 'Política de privacidad', 'footer.terms': 'Términos del servicio',
      'legal.privacyTitle': 'Política de privacidad', 'legal.privacySub': 'Valoramos tu privacidad. Esta política explica qué información recopilamos, cómo se usa y protege, y tus derechos.',
      'legal.termsTitle': 'Términos del servicio', 'legal.termsSub': 'Antes de usar este sitio web y descargar productos, lee y acepta los siguientes términos.',
      'btn.refresh': '↻ Actualizar', 'btn.autoOff': 'Auto off', 'btn.autoOn': 'Auto on', 'btn.checkUpdate': '↻ Buscar actualizaciones',
      'btn.logout': 'Cerrar sesión', 'btn.login': 'Iniciar sesión',
      'btn.backHome': 'Volver al inicio', 'btn.retry': 'Reintentar', 'btn.download': 'Descargar', 'btn.submit': 'Enviar mensaje', 'btn.sending': 'Enviando…',
      'err.quickNav': 'Enlaces rápidos', 'err.search': 'Buscar en el sitio', 'err.searchPh': 'Buscar productos…', 'err.searchEmpty': 'No se encontraron productos', 'err.searchOffline': 'La búsqueda requiere conexión. Inténtalo de nuevo cuando vuelvas a estar en línea', 'err.matchCat': 'Categoría', 'err.matchType': 'Tipo', 'err.matchDesc': 'Descripción',
      'pwa.update': 'Hay una nueva versión. Actualiza para actualizar.', 'pwa.refresh': 'Actualizar', 'pwa.close': 'Cerrar',
      'readonly.banner': 'Estás en modo de solo lectura (viewer). Solo puedes ver datos; las acciones de escritura están desactivadas.',
      'login.title': 'Panel LVJIAOXI', 'login.sub': 'Inicia sesión con una cuenta de administrador',
      'login.user': 'Usuario', 'login.pass': 'Contraseña',
      'login.userPh': 'predeterminado: admin', 'login.passPh': 'predeterminado: admin123',
      'login.err': 'Usuario o contraseña incorrectos', 'login.back': '← Volver al sitio',
      'dash.title': 'Panel', 'role.admin': 'Admin', 'role.viewer': 'Lector',
      'panel.trend': 'Tendencia de tráfico', 'trend.days': 'Últimos {n} días', 'trend.dayUnit': 'd', 'trend.total': 'Total del período: {v} visitas · {d} descargas', 'legend.views': 'Vistas', 'legend.downloads': 'Descargas',
      'panel.products': 'Productos', 'panel.contacts': 'Mensajes', 'panel.audit': 'Registro de auditoría',
      'panel.accesslog': 'Registro de acceso', 'panel.admins': 'Administradores',
      'admin.self': 'Cuenta actual', 'admin.delete': 'Eliminar', 'admin.roleTitle': 'Cambiar rol', 'admin.roleConfirm': '¿Cambiar el rol de "{name}" a "{role}"?', 'admin.confirm': 'Confirmar', 'admin.deleteTitle': 'Eliminar cuenta', 'admin.deleteConfirm': '¿Eliminar la cuenta "{name}"? Esta acción no se puede deshacer.',
      'kpi.views': 'Visitas totales', 'kpi.downloads': 'Descargas totales', 'kpi.products': 'Productos activos',
      'kpi.contacts': 'Mensajes', 'kpi.pending': 'Pendientes', 'kpi.today': 'Vistas de hoy',
      'kpi.monitored': 'Páginas monitorizadas', 'kpi.productCount': 'N.º de productos',
      'status.on': 'Activo', 'status.off': 'Inactivo', 'status.markPending': 'Marcar pendiente', 'status.markDone': 'Marcar hecho',
      'type.app': 'Aplicación', 'type.game': 'Juego', 'empty.none': 'Sin datos', 'empty.referrers': 'Sin referrers',
      'product.edit': 'Editar', 'product.delete': 'Eliminar', 'contact.reply': 'Responder', 'contact.delete': 'Eliminar', 'contact.deleteTitle': 'Eliminar mensaje', 'contact.deleteConfirm': '¿Eliminar este mensaje? No se puede deshacer.', 'contact.selectAll': 'Seleccionar página', 'contact.markDoneSel': 'Marcar como hecho', 'contact.delSel': 'Eliminar seleccionados', 'contact.batchCount': '{n} seleccionados', 'contact.delSelTitle': 'Eliminar mensajes', 'contact.delSelConfirm': '¿Eliminar los {n} mensajes seleccionados? No se puede deshacer.', 'product.deleteTitle': 'Eliminar producto', 'product.deleteConfirm': '¿Eliminar el producto «{name}»? No se puede deshacer.',
      'action.shelfOn': 'Publicar', 'action.shelfOff': 'Ocultar',
      'bulk.selectAll': 'Seleccionar todo', 'bulk.batchCount': '{n} productos seleccionados', 'bulk.shelfOn': 'Publicar en lote', 'bulk.shelfOff': 'Ocultar en lote', 'bulk.category': 'Cambiar categoría', 'bulk.del': 'Eliminar seleccionados', 'bulk.delTitle': 'Eliminar productos', 'bulk.delConfirm': '¿Eliminar los {n} productos seleccionados? No se puede deshacer.', 'bulk.done': 'Hecho', 'bulk.fail': 'La operación masiva falló: ', 'bulk.needSel': 'Selecciona productos primero',
      'panel.maintenance': 'Mantenimiento del sitio', 'maint.desc': 'Al activarlo, las páginas públicas y las API devolverán avisos de mantenimiento (el backend y los recursos estáticos no se ven afectados).', 'maint.msg': 'Mensaje de mantenimiento (opcional, se muestra en la página, ≤200 caracteres)', 'maint.on': 'Activar mantenimiento', 'maint.off': 'Desactivar mantenimiento', 'maint.statusOn': 'En mantenimiento', 'maint.statusOff': 'Funcionamiento normal', 'maint.confirmTitle': 'Confirmar activación', 'maint.confirm': 'Al activarlo, los visitantes no podrán acceder al frontend; solo los administradores podrán iniciar sesión por el backend.', 'maint.done': 'Operación exitosa',
      'panel.feedback': 'Comentarios de productos', 'fb.filterProduct': 'Todos los productos', 'fb.empty': 'Aún no hay comentarios', 'fb.unrated': 'Sin puntuar', 'fb.markDone': 'Marcar como procesado', 'fb.markPending': 'Reabrir', 'fb.delTitle': 'Eliminar comentario', 'fb.delConfirm': '¿Eliminar este comentario? No se puede deshacer.', 'fb.title': 'Comentarios de usuarios', 'fb.sub': 'Cuéntanos tu experiencia con este producto (puntuación opcional)', 'fb.rate': 'Puntuación (opcional)', 'fb.namePh': 'Tu nombre (opcional)', 'fb.content': 'Comentario *', 'fb.contentPh': 'Experiencia, sugerencias o problemas…', 'fb.submit': 'Enviar', 'fb.sending': 'Enviando…', 'fb.ok': '¡Gracias por tu comentario!', 'fb.err': 'Error al enviar, inténtalo de nuevo más tarde', 'fb.need': 'Escribe tu comentario', 'fb.badMail': 'Formato de correo no válido', 'search.feedback': 'Buscar comentario / nombre / correo…',
      'panel.fbOverview': 'Resumen de comentarios', 'fb.avgBy': 'Valorado por {n} usuarios', 'fb.recent': 'Reseñas recientes', 'fb.anon': 'Anónimo', 'fb.byProduct': 'Por producto', 'fb.week7': 'Últimos 7 días', 'kpi.fbTotal': 'Total de comentarios', 'kpi.fbPending': 'Pendientes', 'kpi.fbRated': 'Valorados', 'kpi.fbAvg': 'Nota media', 'btn.exportStats': 'Exportar CSV de análisis', 'chg.title': 'Novedades de productos', 'chg.sub': 'Lanzamientos y actualizaciones de todos los productos en una página.', 'chg.empty': 'Sin novedades por ahora', 'chg.noLog': 'Sin notas de versión', 'chg.loadErr': 'Error al cargar, inténtalo de nuevo',
      'csv.contacts': 'Mensajes LVJIAOXI', 'csv.products': 'Productos LVJIAOXI',
      'col.name': 'Nombre', 'col.email': 'Correo', 'col.message': 'Mensaje', 'col.status': 'Estado',
      'col.time': 'Hora', 'col.actions': 'Acciones', 'col.category': 'Categoría',
      'status.pending': 'Pendiente', 'status.done': 'Hecho', 'status.ignored': 'Ignorado',
      'contact.title': 'Contáctanos', 'contact.sub': 'Ya sea colaboración comercial, sugerencia de producto o consulta de prensa — deja tu información y te responderemos pronto.',
      'contact.name': 'Nombre', 'contact.email': 'Correo', 'contact.msg': 'Mensaje',
      'contact.namePh': 'Tu nombre', 'contact.emailPh': 'you@example.com', 'contact.msgPh': 'Escribe algo…',
      'contact.other': 'Otros contactos', 'contact.slogan': 'Apps y juegos al alcance de tu mano',
      'panel.pageViews': 'Vistas por página', 'panel.sources': 'Fuentes de tráfico', 'panel.referrers': 'Principales referrers',
      'panel.langDist': 'Distribución de idiomas', 'panel.tzDist': 'Zonas horarias (por región)', 'panel.browserDist': 'Navegadores', 'panel.osDist': 'Sistemas operativos', 'panel.topDownloads': 'Descargas populares',
      'panel.security': 'Seguridad de la cuenta', 'panel.sysinfo': 'Información del sistema',
      'chips.all': 'Todos', 'chips.new': 'Pendientes', 'chips.done': 'Hechos',
      'search.contact': 'Buscar nombre / correo / mensaje…', 'search.product': 'Buscar productos…', 'search.audit': 'Buscar acción / detalle / IP…',
      'f.name': 'Nombre *', 'f.type': 'Tipo *', 'f.category': 'Categoría', 'f.icon': 'Icono (emoji)', 'f.image': 'Imagen del producto', 'f.imagePh': 'https://… o /assets/img/products/xx.jpg (vacío = emoji)', 'f.upload': '⬆ Subir imagen', 'f.sort': 'Peso de orden', 'f.sortPh': 'Mayor = primero (por defecto 0)', 'f.url': 'URL de descarga', 'f.desc': 'Descripción', 'f.version': 'Versión', 'f.versionPh': 'p. ej. 1.2.0', 'f.changelog': 'Novedades', 'f.changelogPh': 'Una entrada por línea, formato libre, p. ej.: v1.2.0 · 2026-08-20', 'pd.changelog': 'Novedades', 'pd.downloads': 'descargas', 'pd.related': 'Relacionados', 'hot.title': 'Descargas populares', 'hot.sub': 'Aplicaciones y juegos que la gente está descargando.', 'hot.empty': 'Aún no hay datos populares', 'sort.default': 'Orden por defecto', 'sort.new': 'Más recientes', 'sort.hot': 'Descargas', 'sort.name': 'Nombre',
      'btn.addProduct': 'Añadir producto', 'btn.cancelEdit': 'Cancelar edición',
      'pw.current': 'Contraseña actual', 'pw.new': 'Nueva contraseña (mín. 6)', 'pw.confirm': 'Confirmar contraseña', 'btn.updatePw': 'Actualizar contraseña',
      'na.user': 'Usuario', 'na.pass': 'Contraseña (mín. 6)', 'na.role': 'Rol', 'btn.addAccount': 'Añadir cuenta',
      'btn.exportCsv': '⬇ Exportar CSV', 'btn.exportAudit': '⬇ Exportar auditoría', 'btn.importCsv': '⬆ Importar CSV', 'import.ok': 'Se importaron {n} productos', 'btn.backupDb': '⬇ Copiar BD', 'btn.refreshAudit': '↻ Actualizar',
      'panel.categories': 'Gestión de categorías', 'cat.none': '(Sin categoría)', 'cat.name': 'Nombre de categoría', 'cat.add': 'Añadir categoría', 'cat.usage': 'Usado por', 'cat.rename': 'Renombrar', 'cat.delete': 'Eliminar', 'cat.delTitle': 'Eliminar categoría', 'cat.confirmDel': '¿Eliminar la categoría "{name}"? Esta acción no se puede deshacer.', 'cat.save': 'Guardar', 'cat.empty': 'Aún no hay categorías. Añade una primero.', 'cat.needName': 'Introduce el nombre de la categoría', 'panel.announcements': 'Banda de anuncios', 'ann.content': 'Contenido del anuncio (banner superior, ≤200 caracteres)', 'ann.add': 'Publicar', 'ann.empty': 'Aún no hay anuncios. Al publicarlos aparecerán en el banner superior de todo el sitio.', 'ann.delete': 'Eliminar', 'ann.delTitle': 'Eliminar anuncio', 'ann.confirmDel': '¿Eliminar el anuncio "{content}"?', 'ann.needContent': 'El anuncio no puede estar vacío', 'ann.added': 'Anuncio publicado',
      'col.id': 'ID', 'col.type': 'Tipo', 'col.downloads': 'Descargas', 'col.sort': 'Orden', 'col.version': 'Versión', 'empty.products': 'Sin productos'
    },
    fr: {
      'nav.home': 'Accueil', 'nav.company': 'Société', 'nav.apps': 'Applications', 'nav.games': 'Jeux',
      'nav.contact': 'Contact', 'nav.download': 'Télécharger', 'nav.admin': 'Admin', 'nav.api': 'API', 'nav.changelog': 'Mises à jour',
      'nav.toggleTheme': 'Changer de thème', 'nav.searchPh': 'Rechercher des produits…', 'nav.searchInput': 'Rechercher des produits', 'nav.searchBtn': 'Rechercher', 'nav.searchForm': 'Recherche sur le site', 'nav.menu': 'Ouvrir le menu',
      'footer.copy': '© 2026 LVJIAOXI · Applications et jeux à portée de main',
      'footer.home': 'Accueil', 'footer.contact': 'Contact', 'footer.api': 'API', 'footer.admin': 'Admin',
      'footer.privacy': 'Politique de confidentialité', 'footer.terms': 'Conditions d\'utilisation',
      'legal.privacyTitle': 'Politique de confidentialité', 'legal.privacySub': 'Nous accordons de l\'importance à votre vie privée. Cette politique explique quelles informations nous collectons, comment elles sont utilisées et protégées, et vos droits.',
      'legal.termsTitle': 'Conditions d\'utilisation', 'legal.termsSub': 'Avant d\'utiliser ce site et de télécharger des produits, veuillez lire et accepter les conditions suivantes.',
      'btn.refresh': '↻ Actualiser', 'btn.autoOff': 'Auto off', 'btn.autoOn': 'Auto on', 'btn.checkUpdate': '↻ Rechercher des mises à jour',
      'btn.logout': 'Se déconnecter', 'btn.login': "Se connecter",
      'btn.backHome': "Retour à l'accueil", 'btn.retry': 'Réessayer', 'btn.download': 'Télécharger', 'btn.submit': 'Envoyer', 'btn.sending': 'Envoi…',
      'err.quickNav': 'Liens rapides', 'err.search': 'Recherche sur le site', 'err.searchPh': 'Rechercher des produits…', 'err.searchEmpty': 'Aucun produit trouvé', 'err.searchOffline': 'La recherche nécessite une connexion. Réessayez une fois en ligne', 'err.matchCat': 'Catégorie', 'err.matchType': 'Type', 'err.matchDesc': 'Description',
      'pwa.update': 'Une nouvelle version est disponible. Actualisez pour mettre à jour.', 'pwa.refresh': 'Actualiser', 'pwa.close': 'Fermer',
      'readonly.banner': 'Vous êtes en mode lecture seule (viewer). La consultation est possible, mais l\'écriture est désactivée.',
      'login.title': 'Admin LVJIAOXI', 'login.sub': 'Connectez-vous avec un compte admin',
      'login.user': "Nom d'utilisateur", 'login.pass': 'Mot de passe',
      'login.userPh': 'défaut : admin', 'login.passPh': 'défaut : admin123',
      'login.err': 'Identifiant ou mot de passe incorrect', 'login.back': '← Retour au site',
      'dash.title': 'Tableau de bord', 'role.admin': 'Admin', 'role.viewer': 'Lecteur',
      'panel.trend': 'Tendance du trafic', 'trend.days': '{n} derniers jours', 'trend.dayUnit': 'j', 'trend.total': 'Total de la période : {v} vues · {d} téléchargements', 'legend.views': 'Vues', 'legend.downloads': 'Téléchargements',
      'panel.products': 'Produits', 'panel.contacts': 'Messages', 'panel.audit': 'Journal d\'audit',
      'panel.accesslog': 'Journal d\'accès', 'panel.admins': 'Administrateurs',
      'admin.self': 'Compte actuel', 'admin.delete': 'Supprimer', 'admin.roleTitle': 'Changer le rôle', 'admin.roleConfirm': 'Changer le rôle de "{name}" en "{role}" ?', 'admin.confirm': 'Confirmer', 'admin.deleteTitle': 'Supprimer le compte', 'admin.deleteConfirm': 'Supprimer le compte "{name}" ? Cette action est irréversible.',
      'kpi.views': 'Vues totals', 'kpi.downloads': 'Téléchargements totals', 'kpi.products': 'Produits en ligne',
      'kpi.contacts': 'Messages', 'kpi.pending': 'En attente', 'kpi.today': 'Vues du jour',
      'kpi.monitored': 'Pages surveillées', 'kpi.productCount': 'Nb de produits',
      'status.on': 'En ligne', 'status.off': 'Hors ligne', 'status.markPending': 'Marquer en attente', 'status.markDone': 'Marquer traité',
      'type.app': 'Application', 'type.game': 'Jeu', 'empty.none': 'Aucune donnée', 'empty.referrers': 'Aucun référent',
      'product.edit': 'Modifier', 'product.delete': 'Supprimer', 'contact.reply': 'Répondre', 'contact.delete': 'Supprimer', 'contact.deleteTitle': 'Supprimer le message', 'contact.deleteConfirm': 'Supprimer ce message ? Cette action est irréversible.', 'contact.selectAll': 'Tout sélectionner', 'contact.markDoneSel': 'Marquer traité', 'contact.delSel': 'Supprimer la sélection', 'contact.batchCount': '{n} sélectionnés', 'contact.delSelTitle': 'Supprimer les messages', 'contact.delSelConfirm': 'Supprimer les {n} messages sélectionnés ? Cette action est irréversible.', 'product.deleteTitle': 'Supprimer le produit', 'product.deleteConfirm': 'Supprimer le produit « {name} » ? Cette action est irréversible.',
      'action.shelfOn': 'Publier', 'action.shelfOff': 'Retirer',
      'bulk.selectAll': 'Tout sélectionner', 'bulk.batchCount': '{n} produits sélectionnés', 'bulk.shelfOn': 'Publier en masse', 'bulk.shelfOff': 'Retirer en masse', 'bulk.category': 'Changer de catégorie', 'bulk.del': 'Supprimer la sélection', 'bulk.delTitle': 'Supprimer les produits', 'bulk.delConfirm': 'Supprimer les {n} produits sélectionnés ? Cette action est irréversible.', 'bulk.done': 'Terminé', 'bulk.fail': 'Échec de l\'opération groupée : ', 'bulk.needSel': 'Sélectionnez d\'abord des produits',
      'panel.maintenance': 'Maintenance du site', 'maint.desc': 'Une fois activé, les pages publiques et les API renvoient des avis de maintenance (le backend et les ressources statiques ne sont pas affectés).', 'maint.msg': 'Message de maintenance (facultatif, affiché sur la page, ≤200 caractères)', 'maint.on': 'Activer la maintenance', 'maint.off': 'Désactiver la maintenance', 'maint.statusOn': 'En maintenance', 'maint.statusOff': 'Fonctionnement normal', 'maint.confirmTitle': 'Confirmer l\'activation', 'maint.confirm': 'Une fois activé, les visiteurs ne peuvent plus accéder au frontend ; seuls les administrateurs peuvent se connecter via le backend.', 'maint.done': 'Opération réussie',
      'panel.feedback': 'Retours produits', 'fb.filterProduct': 'Tous les produits', 'fb.empty': 'Aucun retour pour l\'instant', 'fb.unrated': 'Non noté', 'fb.markDone': 'Marquer comme traité', 'fb.markPending': 'Rouvrir', 'fb.delTitle': 'Supprimer le retour', 'fb.delConfirm': 'Supprimer ce retour ? Cette action est irréversible.', 'fb.title': 'Retours utilisateurs', 'fb.sub': 'Dites-nous ce que vous pensez de ce produit (note facultative)', 'fb.rate': 'Note (facultative)', 'fb.namePh': 'Votre nom (facultatif)', 'fb.content': 'Retour *', 'fb.contentPh': 'Expérience, suggestions ou problèmes…', 'fb.submit': 'Envoyer', 'fb.sending': 'Envoi en cours…', 'fb.ok': 'Merci pour votre retour !', 'fb.err': 'Échec de l\'envoi, réessayez plus tard', 'fb.need': 'Saisissez votre retour', 'fb.badMail': 'Format d\'e-mail invalide', 'search.feedback': 'Rechercher retour / nom / e-mail…',
      'panel.fbOverview': 'Aperçu des commentaires', 'fb.avgBy': 'Noté par {n} utilisateurs', 'fb.recent': 'Derniers avis', 'fb.anon': 'Anonyme', 'fb.byProduct': 'Par produit', 'fb.week7': '7 derniers jours', 'kpi.fbTotal': 'Total commentaires', 'kpi.fbPending': 'En attente', 'kpi.fbRated': 'Notés', 'kpi.fbAvg': 'Note moyenne', 'btn.exportStats': 'Exporter le CSV d\'analyse', 'chg.title': 'Mises à jour des produits', 'chg.sub': 'Les versions et mises à jour de tous nos produits, en une page.', 'chg.empty': 'Aucune mise à jour pour le moment', 'chg.noLog': 'Aucune note de version', 'chg.loadErr': 'Échec du chargement, actualisez la page',
      'csv.contacts': 'Messages LVJIAOXI', 'csv.products': 'Produits LVJIAOXI',
      'col.name': 'Nom', 'col.email': 'E-mail', 'col.message': 'Message', 'col.status': 'Statut',
      'col.time': 'Heure', 'col.actions': 'Actions', 'col.category': 'Catégorie',
      'status.pending': 'En attente', 'status.done': 'Traité', 'status.ignored': 'Ignoré',
      'contact.title': 'Contactez-nous', 'contact.sub': 'Que ce soit pour un partenariat, une suggestion produit ou une demande presse — laissez vos coordonnées et nous répondrons rapidement.',
      'contact.name': 'Nom', 'contact.email': 'E-mail', 'contact.msg': 'Message',
      'contact.namePh': 'Votre nom', 'contact.emailPh': 'you@example.com', 'contact.msgPh': 'Écrivez quelque chose…',
      'contact.other': 'Autres contacts', 'contact.slogan': 'Applications et jeux à portée de main',
      'panel.pageViews': 'Vues par page', 'panel.sources': 'Sources de trafic', 'panel.referrers': 'Principaux référents',
      'panel.langDist': 'Répartition des langues', 'panel.tzDist': 'Fuseaux horaires (région)', 'panel.browserDist': 'Navigateurs', 'panel.osDist': 'Systèmes d\'exploitation', 'panel.topDownloads': 'Téléchargements populaires',
      'panel.security': 'Sécurité du compte', 'panel.sysinfo': 'Informations système',
      'chips.all': 'Tous', 'chips.new': 'En attente', 'chips.done': 'Traités',
      'search.contact': 'Rechercher nom / e-mail / message…', 'search.product': 'Rechercher des produits…', 'search.audit': 'Rechercher action / détail / IP…',
      'f.name': 'Nom *', 'f.type': 'Type *', 'f.category': 'Catégorie', 'f.icon': 'Icône (emoji)', 'f.image': 'Image du produit', 'f.imagePh': 'https://… ou /assets/img/products/xx.jpg (vide = emoji)', 'f.upload': '⬆ Importer une image', 'f.sort': 'Poids de tri', 'f.sortPh': 'Plus grand = premier (défaut 0)', 'f.url': 'Lien de téléchargement', 'f.desc': 'Description', 'f.version': 'Version', 'f.versionPh': 'ex. 1.2.0', 'f.changelog': 'Journal des mises à jour', 'f.changelogPh': 'Une entrée par ligne, format libre, ex. : v1.2.0 · 2026-08-20', 'pd.changelog': 'Journal des mises à jour', 'pd.downloads': 'téléchargements', 'pd.related': 'Associés', 'hot.title': 'Téléchargements populaires', 'hot.sub': 'Applications et jeux populaires en ce moment.', 'hot.empty': 'Pas encore de données populaires', 'sort.default': 'Tri par défaut', 'sort.new': 'Plus récents', 'sort.hot': 'Téléchargements', 'sort.name': 'Nom',
      'btn.addProduct': 'Ajouter un produit', 'btn.cancelEdit': 'Annuler',
      'pw.current': 'Mot de passe actuel', 'pw.new': 'Nouveau mot de passe (min 6)', 'pw.confirm': 'Confirmer', 'btn.updatePw': 'Mettre à jour',
      'na.user': "Nom d'utilisateur", 'na.pass': 'Mot de passe (min 6)', 'na.role': 'Rôle', 'btn.addAccount': 'Ajouter un compte',
      'btn.exportCsv': '⬇ Exporter CSV', 'btn.exportAudit': '⬇ Exporter audit', 'btn.importCsv': '⬆ Importer CSV', 'import.ok': '{n} produits importés', 'btn.backupDb': '⬇ Sauvegarder BD', 'btn.refreshAudit': '↻ Actualiser',
      'panel.categories': 'Gestion des catégories', 'cat.none': '(Aucune catégorie)', 'cat.name': 'Nom de la catégorie', 'cat.add': 'Ajouter une catégorie', 'cat.usage': 'Utilisé par', 'cat.rename': 'Renommer', 'cat.delete': 'Supprimer', 'cat.delTitle': 'Supprimer la catégorie', 'cat.confirmDel': 'Supprimer la catégorie « {name} » ? Cette action est irréversible.', 'cat.save': 'Enregistrer', 'cat.empty': 'Aucune catégorie pour le moment. Ajoutez-en une.', 'cat.needName': 'Veuillez saisir un nom de catégorie', 'panel.announcements': 'Bandeau d\'annonce', 'ann.content': 'Contenu de l\'annonce (bannière supérieure, ≤200 caractères)', 'ann.add': 'Publier', 'ann.empty': 'Aucune annonce pour le moment. Les annonces publiées s\'affichent en haut de tout le site.', 'ann.delete': 'Supprimer', 'ann.delTitle': 'Supprimer l\'annonce', 'ann.confirmDel': 'Supprimer l\'annonce « {content} » ?', 'ann.needContent': 'Le contenu de l\'annonce ne peut pas être vide', 'ann.added': 'Annonce publiée',
      'col.id': 'ID', 'col.type': 'Type', 'col.downloads': 'Téléchargements', 'col.sort': 'Tri', 'col.version': 'Version', 'empty.products': 'Aucun produit'
    }
  };

  var STORE_KEY = 'gr-lang';

  function getLang() {
    try {
      var l = localStorage.getItem(STORE_KEY);
      if (LANGS.indexOf(l) >= 0) return l;
    } catch (e) {}
    return 'zh';
  }

  // 构建下拉选择器（.lang-select 容器 → 按钮 + 菜单）
  function buildSelect(container) {
    container.classList.add('lang-select');
    var html = '';
    html += '<button type="button" class="lang-toggle" aria-haspopup="listbox" aria-expanded="false" aria-label="Language / 语言">';
    html += '<span class="lang-current"></span><span class="lang-caret" aria-hidden="true">▾</span>';
    html += '</button>';
    html += '<ul class="lang-menu" role="listbox" hidden>';
    for (var i = 0; i < LANGS.length; i++) {
      html += '<li role="option" data-lang="' + LANGS[i] + '">' + LANG_NAMES[LANGS[i]] + '</li>';
    }
    html += '</ul>';
    container.innerHTML = html;

    var btn = container.querySelector('.lang-toggle');
    var menu = container.querySelector('.lang-menu');
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (menu.hasAttribute('hidden')) {
        menu.removeAttribute('hidden');
        btn.setAttribute('aria-expanded', 'true');
      } else {
        menu.setAttribute('hidden', '');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
    menu.addEventListener('click', function (e) {
      var li = e.target.closest && e.target.closest('[data-lang]');
      if (!li) return;
      closeAll();
      setLang(li.getAttribute('data-lang'));
    });
  }

  function closeAll() {
    var nodes = document.querySelectorAll('.lang-select');
    for (var i = 0; i < nodes.length; i++) {
      var m = nodes[i].querySelector('.lang-menu');
      var b = nodes[i].querySelector('.lang-toggle');
      if (m) m.setAttribute('hidden', '');
      if (b) b.setAttribute('aria-expanded', 'false');
    }
  }

  // 应用某语言：替换文案 + 同步下拉 UI + 派发事件
  function setLang(lang) {
    if (!DICT[lang]) lang = 'zh';
    var dict = DICT[lang];
    document.documentElement.setAttribute('lang', lang === 'zh' ? 'zh-CN' : lang);

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var t = dict[el.getAttribute('data-i18n')];
      if (t != null) el.textContent = t;
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(function (el) {
      var t = dict[el.getAttribute('data-i18n-ph')];
      if (t != null) el.setAttribute('placeholder', t);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      var t = dict[el.getAttribute('data-i18n-title')];
      if (t != null) { el.setAttribute('title', t); el.setAttribute('aria-label', t); }
    });

    // 同步所有下拉选择器
    document.querySelectorAll('.lang-select').forEach(function (c) {
      var cur = c.querySelector('.lang-current');
      if (cur) cur.textContent = LANG_NAMES[lang];
      var menu = c.querySelector('.lang-menu');
      if (menu) {
        menu.setAttribute('hidden', '');
        menu.querySelectorAll('[data-lang]').forEach(function (li) {
          if (li.getAttribute('data-lang') === lang) {
            li.setAttribute('aria-selected', 'true');
            li.classList.add('active');
          } else {
            li.removeAttribute('aria-selected');
            li.classList.remove('active');
          }
        });
      }
      var btn = c.querySelector('.lang-toggle');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });

    try { localStorage.setItem(STORE_KEY, lang); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('gr:langchange', { detail: { lang: lang } })); } catch (e) {}
  }

  function boot() {
    // 先把空容器升级为下拉
    document.querySelectorAll('.lang-select').forEach(buildSelect);
    setLang(getLang());
  }

  // 全局：点击非下拉区域 / Esc 关闭菜单
  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('.lang-select')) closeAll();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAll();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.GRI18n = { get: getLang, set: setLang, langs: LANGS, names: LANG_NAMES, dict: DICT };
})();
