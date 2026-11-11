// M2：typed 投影层。
// 目标：把火眼"全解析结果"的 CSV 按真实表头签名投影成结构化表（只读派生），
// 原始行仍然完整保存在 record 表里（fields_json 保留中文列名），typed 表只是可查询视图。
//
// 设计取舍：
// - 用"表头签名"而不是 (app, category) 判断类型：火眼改版时类别名可能变，但列名相对稳定；
//   同一类数据（如 WhatsApp 与微信的消息 CSV）共用同一张表。
// - 所有映射都是"候选列名 fallback"（中文列名/别名/旧名），缺列写 null，不抛错。
// - 不做类型强转（金额/大小保留原文），避免把 "1.24 MB" 解析错；需要数值时在查询层处理。

/** typed 表清单：表名 → 列（不含公共列 record_id/eid/app/account/subcat）。 */
export const TYPED_TABLES = {
  contact: ['user_id', 'internal_id', 'nickname', 'display_name', 'real_name', 'phone', 'remark', 'group_name'],
  account_info: ['user_id', 'account_name', 'nickname', 'display_name', 'real_name', 'phone', 'password', 'login_url', 'source'],
  msg_csv: ['speaker', 'speaker_id', 'receiver', 'receiver_id', 'ts', 'body', 'origin_record_id'],
  chat_group: ['group_id', 'name', 'owner_id', 'owner_name', 'announcement', 'intro', 'joined_at'],
  call_log: ['initiator', 'receiver', 'direction', 'call_type', 'status', 'start_ts', 'connect_ts', 'end_ts', 'name', 'number', 'duration', 'source_app'],
  sms: ['name', 'number', 'direction', 'ts', 'body', 'read_state', 'attachment'],
  web_visit: ['title', 'url', 'search_term', 'ts', 'created_at', 'kind'],
  exif: ['name', 'taken_at', 'modified_at', 'software', 'lat', 'lon'],
  file_meta: ['name', 'size_text', 'created_at', 'modified_at', 'deleted_at', 'device_path', 'album', 'app_tag'],
  app_install: ['name', 'package', 'version', 'category', 'app_type', 'installed_at', 'last_used_at', 'screen_pos'],
  app_usage: ['app_name', 'description', 'ts', 'start_ts', 'end_ts', 'log_type'],
  app_permission: ['app_name', 'service', 'last_request_at', 'grant', 'count_text'],
  sim_card: ['phone', 'imsi', 'iccid', 'sim_id', 'carrier', 'display_name', 'mcc', 'mnc', 'updated_at'],
  wifi_record: ['ssid', 'password', 'last_manual_at', 'last_auto_at', 'encryption', 'mac', 'lat', 'lon', 'freq', 'signal'],
  bt_device: ['name', 'mac', 'status', 'last_connected_at'],
  net_usage: ['app_name', 'package', 'start_ts', 'end_ts', 'wifi_dl', 'wifi_ul', 'cell_dl', 'cell_ul'],
  calendar_event: ['title', 'content', 'address', 'start_ts', 'remind_at', 'all_day'],
  mini_program: ['brand_id', 'app_id', 'name', 'company', 'signature', 'last_started_at', 'url', 'source_account'],
  moment: ['user_name', 'user_id', 'ts', 'content', 'comments'],
  favorite: ['sender', 'sender_id', 'ts', 'content', 'source_account'],
  device_info: ['item', 'value'],
  device_storage: ['free_text', 'used_text', 'total_text', 'ts'],
  entity_row: ['kind', 'value', 'extra_json', 'count_text'],
  health_metric: ['metric', 'value_text', 'start_ts', 'end_ts', 'source_name', 'device_text'],
};

const COMMON_COLS = ['record_id', 'eid', 'app', 'account', 'subcat'];

export const TYPED_DDL = `
${Object.entries(TYPED_TABLES)
  .map(
    ([table, cols]) => `create table if not exists ${table}(
  id integer primary key, ${COMMON_COLS.join(', ')}, ${cols.join(', ')});`
  )
  .join('\n')}
create table if not exists citation(
  record_id integer primary key, artifact_id integer, eid integer, base_handle text, node_id text,
  line_no integer, citable integer, status text, method text, verified_at text);
create table if not exists column_map(
  app text, category text, kind text, column text, target_table text, target_field text, seen integer,
  primary key(app, category, column));
create index if not exists idx_citation_handle on citation(base_handle);
${Object.keys(TYPED_TABLES)
  .map((t) => `create index if not exists idx_${t}_rec on ${t}(record_id);`)
  .join('\n')}
create index if not exists idx_contact_phone on contact(phone);
create index if not exists idx_msg_csv_ts on msg_csv(ts);
create index if not exists idx_entity_row_kind on entity_row(kind, value);
`;

const has = (f, ...names) => names.every((n) => Object.prototype.hasOwnProperty.call(f, n));
const hasAny = (f, ...names) => names.some((n) => Object.prototype.hasOwnProperty.call(f, n));

/** 按候选列名取第一个非空值（保留原始字符串，不做类型转换）。 */
function pick(f, ...names) {
  for (const n of names) {
    const v = f[n];
    if (v != null && String(v).trim() !== '') return String(v);
  }
  return null;
}

/**
 * CSV 行 + 路径分类 → typed 投影。
 * @returns {{table: string, row: object, mapping: Array<[column, field]>} | null}
 */
export function projectCsvRow(fields, c) {
  const keys = Object.keys(fields);
  const mk = (table, row, mapping) => ({ table, row, mapping });

  // ---------- 群/频道/社群列表 ----------
  if (has(fields, '群组ID')) {
    return mk(
      'chat_group',
      {
        group_id: pick(fields, '群组ID'),
        name: pick(fields, '群组名称'),
        owner_id: pick(fields, '群主ID'),
        owner_name: pick(fields, '群主昵称'),
        announcement: pick(fields, '群公告'),
        intro: pick(fields, '群简介'),
        joined_at: pick(fields, '加入时间'),
      },
      [['group_id', '群组ID'], ['name', '群组名称'], ['owner_id', '群主ID'], ['owner_name', '群主昵称'], ['announcement', '群公告'], ['intro', '群简介'], ['joined_at', '加入时间']]
    );
  }

  // ---------- 消息 CSV（WhatsApp/微信各类消息、频道消息、消息碎片） ----------
  if (has(fields, '发送者ID') && has(fields, '消息内容')) {
    return mk(
      'msg_csv',
      {
        speaker: pick(fields, '发送者'),
        speaker_id: pick(fields, '发送者ID'),
        receiver: pick(fields, '接收者'),
        receiver_id: pick(fields, '接收者ID'),
        ts: pick(fields, '发送时间'),
        body: pick(fields, '消息内容'),
        origin_record_id: pick(fields, '原文记录ID'),
      },
      [['speaker', '发送者'], ['speaker_id', '发送者ID'], ['receiver', '接收者'], ['receiver_id', '接收者ID'], ['ts', '发送时间'], ['body', '消息内容'], ['origin_record_id', '原文记录ID']]
    );
  }

  // ---------- 短信（先于通话记录判断：短信也有 名称/号码/类型/时间） ----------
  if (has(fields, '号码') && has(fields, '内容') && has(fields, '类型')) {
    return mk(
      'sms',
      {
        name: pick(fields, '名称'),
        number: pick(fields, '号码'),
        direction: pick(fields, '类型'),
        ts: pick(fields, '时间'),
        body: pick(fields, '内容'),
        read_state: pick(fields, '已读'),
        attachment: pick(fields, '附件'),
      },
      [['name', '名称'], ['number', '号码'], ['direction', '类型'], ['ts', '时间'], ['body', '内容'], ['read_state', '已读'], ['attachment', '附件']]
    );
  }

  // ---------- 通话记录：WhatsApp 版 ----------
  if (has(fields, '发起者') && has(fields, '会话方向')) {
    return mk(
      'call_log',
      {
        initiator: pick(fields, '发起者'),
        receiver: pick(fields, '接受者'),
        direction: pick(fields, '会话方向'),
        call_type: pick(fields, '会话类型'),
        status: pick(fields, '会话状态'),
        start_ts: pick(fields, '发起时间'),
        connect_ts: pick(fields, '连接时间'),
        end_ts: pick(fields, '结束时间'),
      },
      [['initiator', '发起者'], ['receiver', '接受者'], ['direction', '会话方向'], ['call_type', '会话类型'], ['status', '会话状态'], ['start_ts', '发起时间'], ['connect_ts', '连接时间'], ['end_ts', '结束时间']]
    );
  }

  // ---------- 通话记录：iOS 版 ----------
  if (has(fields, '通话时长') && has(fields, '号码')) {
    return mk(
      'call_log',
      {
        direction: pick(fields, '类型'),
        start_ts: pick(fields, '时间'),
        name: pick(fields, '名称'),
        number: pick(fields, '号码'),
        duration: pick(fields, '通话时长'),
        source_app: pick(fields, '双卡标识'),
        status: pick(fields, '转文字'),
      },
      [['direction', '类型'], ['start_ts', '时间'], ['name', '名称'], ['number', '号码'], ['duration', '通话时长'], ['source_app', '双卡标识'], ['status', '转文字']]
    );
  }

  // ---------- 联系人 / 账号信息（7 列通用人形） ----------
  if (has(fields, '用户ID') && has(fields, '内部ID')) {
    const isAccount = c.category === '账户信息';
    const row = {
      user_id: pick(fields, '用户ID'),
      internal_id: pick(fields, '内部ID'),
      nickname: pick(fields, '昵称'),
      display_name: pick(fields, '显示名'),
      real_name: pick(fields, '真实姓名'),
      phone: pick(fields, '手机号'),
      remark: pick(fields, '备注'),
    };
    const mapping = [
      ['user_id', '用户ID'], ['internal_id', '内部ID'], ['昵称', '昵称'], ['display_name', '显示名'],
      ['real_name', '真实姓名'], ['phone', '手机号'], ['remark', '备注'],
    ].map(([a, b]) => (a === '昵称' ? ['nickname', '昵称'] : [a, b]));
    if (isAccount) return mk('account_info', { ...row, account_name: pick(fields, '昵称', '显示名') }, mapping);
    return mk('contact', { ...row, group_name: c.subcat || null }, mapping);
  }

  // ---------- 账号信息（iOS：用户ID/账户名/密码/登录url/来源） ----------
  if (has(fields, '账户名') && has(fields, '用户ID')) {
    return mk(
      'account_info',
      {
        user_id: pick(fields, '用户ID'),
        account_name: pick(fields, '账户名'),
        password: pick(fields, '密码'),
        login_url: pick(fields, '登录url', '登录URL'),
        source: pick(fields, '来源'),
      },
      [['user_id', '用户ID'], ['account_name', '账户名'], ['password', '密码'], ['login_url', '登录url'], ['source', '来源']]
    );
  }

  // ---------- 搜索历史 ----------
  if (has(fields, '搜索内容')) {
    return mk(
      'web_visit',
      { title: pick(fields, '搜索内容'), url: pick(fields, 'URL'), search_term: pick(fields, '搜索内容'), ts: pick(fields, '时间'), kind: 'search' },
      [['title', '搜索内容'], ['url', 'URL'], ['search_term', '搜索内容'], ['ts', '时间']]
    );
  }

  // ---------- Safari 浏览/书签/标签页 ----------
  if (has(fields, '标题') && has(fields, 'URL')) {
    const kind = c.category === '书签记录' ? 'bookmark' : c.category === '未关闭的标签页' ? 'open_tab' : c.category === '标签页记录' ? 'tab' : 'visit';
    return mk(
      'web_visit',
      {
        title: pick(fields, '标题'),
        url: pick(fields, 'URL'),
        ts: pick(fields, '最后访问时间', '创建时间'),
        created_at: pick(fields, '创建时间'),
        kind,
      },
      [['title', '标题'], ['url', 'URL'], ['ts', '最后访问时间'], ['created_at', '创建时间']]
    );
  }

  // ---------- 图片 Exif ----------
  if (has(fields, '拍摄时间') && hasAny(fields, '纬度(度分秒表示法)', '纬度')) {
    return mk(
      'exif',
      {
        name: pick(fields, '名称'),
        taken_at: pick(fields, '拍摄时间'),
        modified_at: pick(fields, '修改时间'),
        software: pick(fields, '软件'),
        lat: pick(fields, '纬度(度分秒表示法)', '纬度'),
        lon: pick(fields, '经度(度分秒表示法)', '经度'),
      },
      [['name', '名称'], ['taken_at', '拍摄时间'], ['modified_at', '修改时间'], ['software', '软件'], ['lat', '纬度(度分秒表示法)'], ['lon', '经度(度分秒表示法)']]
    );
  }

  // ---------- 网络使用详情（先于应用列表：也有包名） ----------
  if (has(fields, '应用包名') && hasAny(fields, 'WiFi下载流量', '数据下载流量')) {
    return mk(
      'net_usage',
      {
        app_name: pick(fields, '应用名称'),
        package: pick(fields, '应用包名'),
        start_ts: pick(fields, '开始时间'),
        end_ts: pick(fields, '结束时间'),
        wifi_dl: pick(fields, 'WiFi下载流量'),
        wifi_ul: pick(fields, 'WiFi上传流量'),
        cell_dl: pick(fields, '数据下载流量'),
        cell_ul: pick(fields, '数据上传流量'),
      },
      [['app_name', '应用名称'], ['package', '应用包名'], ['start_ts', '开始时间'], ['end_ts', '结束时间'], ['wifi_dl', 'WiFi下载流量'], ['wifi_ul', 'WiFi上传流量'], ['cell_dl', '数据下载流量'], ['cell_ul', '数据上传流量']]
    );
  }

  // ---------- 应用列表 ----------
  if (has(fields, '包名') && has(fields, '名称')) {
    return mk(
      'app_install',
      {
        name: pick(fields, '名称'),
        package: pick(fields, '包名'),
        version: pick(fields, '版本名称'),
        category: pick(fields, '应用分类'),
        app_type: pick(fields, '应用类型'),
        installed_at: pick(fields, '安装时间'),
        last_used_at: pick(fields, '最后使用时间'),
        screen_pos: pick(fields, '屏幕位置'),
      },
      [['name', '名称'], ['package', '包名'], ['version', '版本名称'], ['category', '应用分类'], ['app_type', '应用类型'], ['installed_at', '安装时间'], ['last_used_at', '最后使用时间'], ['screen_pos', '屏幕位置']]
    );
  }

  // ---------- 应用授权日志 ----------
  if (has(fields, '请求服务')) {
    return mk(
      'app_permission',
      {
        app_name: pick(fields, '应用名称'),
        service: pick(fields, '请求服务'),
        last_request_at: pick(fields, '最后申请时间'),
        grant: pick(fields, '授权'),
        count_text: pick(fields, '申请次数'),
      },
      [['app_name', '应用名称'], ['service', '请求服务'], ['last_request_at', '最后申请时间'], ['grant', '授权'], ['count_text', '申请次数']]
    );
  }

  // ---------- App 使用详情 / 苹果健康 ----------
  if (has(fields, '日志描述')) {
    return mk(
      'app_usage',
      {
        app_name: pick(fields, 'App名称'),
        description: pick(fields, '日志描述'),
        ts: pick(fields, '时间'),
        start_ts: pick(fields, '开始时间'),
        end_ts: pick(fields, '结束时间'),
        log_type: pick(fields, '日志类型'),
      },
      [['app_name', 'App名称'], ['description', '日志描述'], ['ts', '时间'], ['start_ts', '开始时间'], ['end_ts', '结束时间'], ['log_type', '日志类型']]
    );
  }

  // ---------- SIM 卡 ----------
  if (hasAny(fields, 'IMSI', 'ICCID')) {
    return mk(
      'sim_card',
      {
        phone: pick(fields, '手机号码'),
        imsi: pick(fields, 'IMSI'),
        iccid: pick(fields, 'ICCID'),
        sim_id: pick(fields, 'SIM ID'),
        carrier: pick(fields, '运营商'),
        display_name: pick(fields, '显示名称'),
        mcc: pick(fields, 'MCC'),
        mnc: pick(fields, 'MNC'),
        updated_at: pick(fields, '上一次更新时间'),
      },
      [['phone', '手机号码'], ['imsi', 'IMSI'], ['iccid', 'ICCID'], ['sim_id', 'SIM ID'], ['carrier', '运营商'], ['display_name', '显示名称'], ['mcc', 'MCC'], ['mnc', 'MNC'], ['updated_at', '上一次更新时间']]
    );
  }

  // ---------- Wi-Fi / 热点 ----------
  if (has(fields, '加密类型') && has(fields, 'Mac地址')) {
    return mk(
      'wifi_record',
      {
        ssid: pick(fields, '名称'),
        password: pick(fields, '密码'),
        last_manual_at: pick(fields, '最后手动连接时间'),
        last_auto_at: pick(fields, '最后自动连接时间'),
        encryption: pick(fields, '加密类型'),
        mac: pick(fields, 'Mac地址'),
        lat: pick(fields, '纬度'),
        lon: pick(fields, '经度'),
        freq: pick(fields, '无线频率'),
        signal: pick(fields, '信号强度'),
      },
      [['ssid', '名称'], ['password', '密码'], ['last_manual_at', '最后手动连接时间'], ['last_auto_at', '最后自动连接时间'], ['encryption', '加密类型'], ['mac', 'Mac地址'], ['lat', '纬度'], ['lon', '经度'], ['freq', '无线频率'], ['signal', '信号强度']]
    );
  }

  // ---------- 蓝牙设备 ----------
  if (has(fields, 'Mac地址') && has(fields, '状态')) {
    return mk(
      'bt_device',
      { name: pick(fields, '名称'), mac: pick(fields, 'Mac地址'), status: pick(fields, '状态'), last_connected_at: pick(fields, '最近连接时间') },
      [['name', '名称'], ['mac', 'Mac地址'], ['status', '状态'], ['last_connected_at', '最近连接时间']]
    );
  }

  // ---------- 设备容量记录 ----------
  if (has(fields, '可用容量')) {
    return mk(
      'device_storage',
      { free_text: pick(fields, '可用容量'), used_text: pick(fields, '已使用容量'), total_text: pick(fields, '总容量'), ts: pick(fields, '时间') },
      [['free_text', '可用容量'], ['used_text', '已使用容量'], ['total_text', '总容量'], ['ts', '时间']]
    );
  }

  // ---------- 日历 ----------
  if (has(fields, '开始时间') && hasAny(fields, '是否全天', '提醒时间')) {
    return mk(
      'calendar_event',
      {
        title: pick(fields, '标题'),
        content: pick(fields, '内容'),
        address: pick(fields, '地址'),
        start_ts: pick(fields, '开始时间'),
        remind_at: pick(fields, '提醒时间'),
        all_day: pick(fields, '是否全天'),
      },
      [['title', '标题'], ['content', '内容'], ['address', '地址'], ['start_ts', '开始时间'], ['remind_at', '提醒时间'], ['all_day', '是否全天']]
    );
  }

  // ---------- 小程序 ----------
  if (has(fields, 'Brand Id')) {
    return mk(
      'mini_program',
      {
        brand_id: pick(fields, 'Brand Id'),
        app_id: pick(fields, '应用Id'),
        name: pick(fields, '应用名称'),
        company: pick(fields, '所属公司'),
        signature: pick(fields, '签名'),
        last_started_at: pick(fields, '最后启动时间'),
        url: pick(fields, 'Url'),
        source_account: pick(fields, '来源账号'),
      },
      [['brand_id', 'Brand Id'], ['app_id', '应用Id'], ['name', '应用名称'], ['company', '所属公司'], ['signature', '签名'], ['last_started_at', '最后启动时间'], ['url', 'Url'], ['source_account', '来源账号']]
    );
  }

  // ---------- 朋友圈 ----------
  if (has(fields, '评论详情')) {
    return mk(
      'moment',
      { user_name: pick(fields, '用户名'), user_id: pick(fields, '用户ID'), ts: pick(fields, '时间'), content: pick(fields, '内容'), comments: pick(fields, '评论详情') },
      [['user_name', '用户名'], ['user_id', '用户ID'], ['ts', '时间'], ['content', '内容'], ['comments', '评论详情']]
    );
  }

  // ---------- 收藏 ----------
  if (has(fields, '来源账号') && has(fields, '发送者')) {
    return mk(
      'favorite',
      { sender: pick(fields, '发送者'), sender_id: pick(fields, '发送者ID'), ts: pick(fields, '时间'), content: pick(fields, '内容'), source_account: pick(fields, '来源账号') },
      [['sender', '发送者'], ['sender_id', '发送者ID'], ['ts', '时间'], ['content', '内容'], ['source_account', '来源账号']]
    );
  }

  // ---------- 设备信息（名称/内容 两列） ----------
  if (keys.length === 2 && has(fields, '名称') && has(fields, '内容')) {
    return mk('device_info', { item: pick(fields, '名称'), value: pick(fields, '内容') }, [['item', '名称'], ['value', '内容']]);
  }

  // ---------- 图片/视频元数据 ----------
  if (has(fields, '名称') && has(fields, '大小') && hasAny(fields, '相簿名称', '手机中路径')) {
    return mk(
      'file_meta',
      {
        name: pick(fields, '名称'),
        size_text: pick(fields, '大小'),
        created_at: pick(fields, '创建时间'),
        modified_at: pick(fields, '修改时间'),
        deleted_at: pick(fields, '删除时间'),
        device_path: pick(fields, '手机中路径'),
        album: pick(fields, '相簿名称'),
        app_tag: pick(fields, '来源应用'),
      },
      [['name', '名称'], ['size_text', '大小'], ['created_at', '创建时间'], ['modified_at', '修改时间'], ['deleted_at', '删除时间'], ['device_path', '手机中路径'], ['album', '相簿名称']]
    );
  }

  // ---------- 实体分类（首列是实体值，含"出现次数"） ----------
  if (hasAny(fields, '出现次数') || c.category && ['IP地址', '快递单号', '手机号', '网址', '虚拟钱包', '身份证', '车牌号', '邮箱', '银行卡'].includes(c.category)) {
    const valueKey = keys[0];
    const extra = {};
    for (const k of keys.slice(1)) if (k !== '出现次数') extra[k] = fields[k];
    return mk(
      'entity_row',
      {
        kind: c.category || '未知',
        value: fields[valueKey] != null ? String(fields[valueKey]) : null,
        extra_json: JSON.stringify(extra),
        count_text: pick(fields, '出现次数'),
      },
      [['value', valueKey]]
    );
  }

  // ---------- iOS 通讯录（头像/名称/号码/归属地/分组…） ----------
  if (has(fields, '名称') && has(fields, '号码') && hasAny(fields, '归属地', '分组', '双卡标识')) {
    return mk(
      'contact',
      {
        nickname: pick(fields, '名称'),
        real_name: pick(fields, '名称'),
        phone: pick(fields, '号码'),
        remark: pick(fields, '归属地', '分组'),
        group_name: pick(fields, '分组'),
      },
      [['nickname', '名称'], ['real_name', '名称'], ['phone', '号码'], ['remark', '归属地'], ['group_name', '分组']]
    );
  }

  // ---------- 苹果健康：指标序列（开始时间/结束时间/<指标值>/来源名称/设备信息…） ----------
  if (has(fields, '开始时间') && has(fields, '结束时间') && has(fields, '来源名称') && has(fields, '设备信息')) {
    const known = new Set(['开始时间', '结束时间', '来源名称', '设备信息']);
    const metricKey = keys.find((k) => !known.has(k)) ?? null;
    return mk(
      'health_metric',
      {
        metric: metricKey,
        value_text: metricKey ? (fields[metricKey] != null ? String(fields[metricKey]) : null) : null,
        start_ts: pick(fields, '开始时间'),
        end_ts: pick(fields, '结束时间'),
        source_name: pick(fields, '来源名称'),
        device_text: pick(fields, '设备信息'),
      },
      [['metric', metricKey ?? '开始时间'], ['value_text', metricKey ?? '开始时间'], ['start_ts', '开始时间'], ['end_ts', '结束时间'], ['source_name', '来源名称'], ['device_text', '设备信息']]
    );
  }

  // ---------- 苹果健康：数据来源（来源名称/创建/修改/删除/设备型号） ----------
  if (has(fields, '来源名称') && hasAny(fields, '设备型号', '创建时间')) {
    return mk(
      'file_meta',
      {
        name: pick(fields, '来源名称'),
        created_at: pick(fields, '创建时间'),
        modified_at: pick(fields, '修改时间'),
        deleted_at: pick(fields, '删除时间'),
        app_tag: pick(fields, '设备型号'),
      },
      [['name', '来源名称'], ['created_at', '创建时间'], ['modified_at', '修改时间'], ['deleted_at', '删除时间'], ['app_tag', '设备型号']]
    );
  }

  // 检材信息由 build 直接写入 evidence 表，这里不重复投影
  if (has(fields, '检材ID')) return null;

  return null;
}
