# 独立展示组件接入

`TopologyViewer` 是浏览器端只读组件，可用于普通 JavaScript、React、Vue 或桌面 WebView。组件不导入编辑器，不访问 localStorage，不请求业务接口，不启动模拟数据计时器。编辑器与组件共用节点、连接点和线缆渲染代码。

## 获取构建产物

在制作工具项目执行 `bun run build:viewer`，生成 `dist-viewer/`：

- `topology-viewer.js`：ES module，包含运行时依赖与组件样式。
- `topology-viewer.umd.js`：普通 script 标签使用，提供 `window.TopologyKit`。
- `types/`：TypeScript 声明。
- `topology-v3.schema.json`：当前通用文件格式的 JSON Schema；保留 `topology-v2.schema.json` 供旧文件校验。
- `package.json`：可在其他工程中本地安装的包描述。

复制整个目录后，可在目标工程使用 `bun install /绝对路径/dist-viewer`。也可直接引用 ES module 或 UMD 文件，不需要安装完整制作工具。此步骤没有自动发布 npm 包。

## JavaScript

```ts
import { TopologyViewer, parseDocument } from '@topology-kit/viewer';

// 由宿主软件读取制作工具导出的 .topology.json 文件。
const definition = parseDocument(yourTopologyJSON);
const viewer = new TopologyViewer(document.getElementById('canvas')!, {
  definition,
  onNodeClick: ({ node, source }) => openBusinessDetail(source, node.id),
});

viewer.setData({
  'switch-001': { stats: { temperature: 42.5 }, health: 'ok' },
});
viewer.updateData({
  'switch-001': { stats: { temperature: 43.1 } },
});

// 新文件先验证再替换；替换文件会清空旧实时数据，再调用 setData 接入新数据。
viewer.setDefinition(anotherTopologyJSON);
viewer.setData(newData);
viewer.fit();
const portableCopy = viewer.getDefinition();
viewer.destroy();
```

容器必须有明确高度，例如 `height: 500px`。`setData()` 完整替换实时数据；`updateData()` 按业务对象合并一层字段，嵌套对象需完整提供。组件拥有自己的容器子元素；销毁只清理当前实例，重复销毁安全。`getDefinition()` 返回副本，实时值和选中状态不进入文档。

普通页面也可使用：

```html
<div id="canvas" style="height:500px"></div>
<script src="./topology-viewer.umd.js"></script>
<script>
  // definition 由宿主加载，组件不自行访问文件或接口。
  const viewer = new TopologyKit.TopologyViewer(
    document.getElementById('canvas'), { definition }
  );
  viewer.setData(data);
</script>
```

## React

已有 React 客户端项目可用薄包装，不需要为每张图生成一套组件源码：

```tsx
import { useEffect, useRef } from 'react';
import { TopologyViewer } from '@topology-kit/viewer';
import type { TopologyDocument, TelemetryData, LinkTelemetryData } from '@topology-kit/viewer';

export function TopologyPanel({ definition, data, linkData }: {
  definition: TopologyDocument;
  data: TelemetryData;
  linkData: LinkTelemetryData;
}) {
  const container = useRef<HTMLDivElement>(null);
  const controller = useRef<TopologyViewer | null>(null);
  const latestData = useRef(data);
  latestData.current = data;
  const latestLinks = useRef(linkData);
  latestLinks.current = linkData;

  useEffect(() => {
    const viewer = new TopologyViewer(container.current!, { definition, linkData: latestLinks.current });
    controller.current = viewer;
    viewer.setData(latestData.current);
    return () => { viewer.destroy(); controller.current = null; };
  }, [definition]);

  useEffect(() => { controller.current?.setData(data); }, [data]);
  useEffect(() => { controller.current?.setLinkData(linkData); }, [linkData]);
  return <div ref={container} style={{ height: 500 }} />;
}
```

这是浏览器组件。SSR 工程应在客户端生命周期内动态导入运行时；类型可以用 `import type` 静态引入。React 开发模式的重复挂载会通过上述清理函数销毁旧实例。

## 数据绑定

在编辑器中选中节点，展开“数据绑定”，配置：

```json
{
  "source": "switch-001",
  "fields": { "temperature": "stats.temperature" },
  "statusField": "health",
  "statusMap": { "ok": "normal", "degraded": "warning", "down": "offline" }
}
```

左侧字段名必须存在于节点模板的参数定义中。右侧支持点分隔对象路径，不执行表达式或 JavaScript。状态使用 `normal / warning / offline`，业务状态可显式映射。未提供映射时，可直接使用这三个状态值。

没有接收到节点的数据时显示“等待数据”和 `—`，不产生演示值。离线节点参数显示 `—`，关联线缆变灰分段。恢复节点后按独立链路状态恢复外观及流转；尚无链路数据时保持未知。更新数据不重新布局、不修改手工拐点。

## 链路状态与流转（0.3.0）

制作工具选中连线可查看链路 ID，并编辑初始状态、动效开关、方向和速度。链路状态为 `up / down / unknown`，与设备状态分开。正向沿 source → target，反向沿 target → source，双向分别播放；流转方向与方向箭头分别配置。

```ts
const viewer = new TopologyViewer(container, {
  definition,
  linkData: { 'link-rx-rf': { status: 'up' } },
  animations: true, // false 整体关闭此实例的流转动画
});
viewer.setLinkData({
  'link-rx-rf': { status: 'up' },
  'link-server': { status: 'down' },
});
viewer.updateLinkData({ 'link-rx-rf': { active: false } }); // 连通空闲，原色静止
viewer.updateLinkData({ 'link-rx-rf': { status: 'up', active: true } });
viewer.updateLinkData({ 'link-rx-rf': { status: 'down' } }); // 置灰、分段、停止
viewer.setLinkData({}); // 清空，恢复未知
```

- 按 `topology.edges[].id` 匹配，可从 `getDefinition()` 读取。复制连线生成新 ID，宿主需重新关联。
- `setLinkData` 替换全部链路数据；`updateLinkData` 按链路合并，可只提供 status 或 active。初次只提供 active 时状态为未知。非法批量更新整体拒绝。
- 设备与链路两类运行数据互不清空；`setDefinition` 清空两类数据。运行值不写入文档或撤销历史。
- 端点设备**明确离线**时链路优先断开，否则采用宿主链路状态。等待端点数据不等于端点明确离线，允许宿主先报告链路连通。
- 尚无链路记录时为未知、静止并淡化。`active` 默认为 true，仅在连通时有效；宿主可用它表示实际有无流量，组件不自行检测流量或连接采集服务。

制作工具模拟模式采用初始状态，查看时播放，编辑画布静态。链路详情支持模拟断开/连通，不改存档。宿主模式尚无链路数据时为未知；验证接口：

```js
window.stationPrototype.updateLinkTelemetry('link-rx-rf', 'up');
window.stationPrototype.updateLinkTelemetry('link-rx-rf', 'up', false);
window.stationPrototype.updateLinkTelemetry('link-rx-rf', 'down');
```

已存在链路自动进入宿主模式并返回 1；未知 ID 返回 0，不切换模式。参数先校验，非法输入不部分写入。运行值跨模拟周期及撤销保留；切图、刷新或主动切换数据模式后需重新发送。

v3 连线增加两个可选字段：

```json
{
  "status": "up",
  "flow": { "enabled": true, "direction": "forward", "speed": "normal" }
}
```

`status` 为初始状态；方向为 `forward / reverse / both`，速度为 `slow / normal / fast`。旧文件缺省为连通、开启动效、正向、标准速度，读取时不自动补写字段；Schema、迁移、复制、保存及撤销均支持。新字段及 API 需要 `0.3.0` 组件，制作和展示端应配套升级。**从 0.2.x 升级后，宿主需单独提供链路状态**，设备在线不自动表示链路连通。

高光沿手工路径流动，外皮和编织纹理固定，双线保留中心间隙。系统“减少动态效果”偏好停止播放；宿主也可用 `animations: false` 关闭单实例动画。PNG/SVG 保留静态状态，HTML 保留流转配置、状态快照和相同 API，可在页面调用 `window.topologyViewer.updateLinkData(...)`，同源 iframe 调用方式与设备 API 相同。

## 模板编辑与复用

制作工具通过表单编辑模板参数及端口，并配置每个节点的绑定源、参数字段路径和状态映射。仍使用 v3 的 `templates` 与 `node.data.binding`，宿主无需更改现有数据结构。

模板 ID 为稳定引用。修改模板会同步引用节点，移除参数时删除对应 `visibleMetrics` 和 `binding.fields` 项，新增参数不自动创建字段映射；保留节点身份、位置、业务绑定源和手工拐点。节点自定义端口独立保留。继承模板且已连接的端口不能删除或变更类型；模板操作可撤销。

单模板导出文件为 `{ format: 'topology-node-template', version: 1, template: NodeTemplate }`，Schema 为 `schema/node-template.schema.json`，复用 v3 模板定义。导入同 ID 时创建独立 ID，不覆盖原模板；可在其他拓扑导入并继续修改。此文件是制作工具的模板交换文件，展示组件仍接收完整拓扑文档。包的 `./schema/template` 提供模板 Schema。

## 状态外观

组件将正常、告警、离线和等待分别以绿色勾选、琥珀色提示、灰色虚线断连、蓝色点线时钟呈现；数据过期使用褐色虚线时钟，连接中断使用红褐色断连提示。节点尺寸和端口位置不因状态变化而改变，参数更新不修改定义。

文件与设备状态 API 仍只接受 `normal / warning / offline`。等待由绑定源尚未收到数据推导；清空数据时恢复等待，收到离线记录时显示真正离线。DOM 的 `data-status` 还可为 `pending / stale / disconnected`，它们是呈现标记，不是文件中的状态值。制作工具属性栏的“初始状态”设置默认值，宿主记录可以覆盖运行状态。

图片和 HTML 快照保留相同状态外观，等待节点不会获得伪造的数据记录。编辑器的蓝灰主题不包含在组件的节点样式中；组件样式仅作用于自身拓扑及控制区。

## 通用文件

导出文件使用 `format: "topology-document"`、`version: 3`，包含：

- 文档 ID、名称、分类、说明和创建/更新时间。
- 文档内节点模板：标识、版本、图标、参数定义、默认连接点。
- 节点：模板标识、名称、业务对象标识、位置、参数展示、绑定、自定义连接点。
- 连线：节点/连接点端点、手工拐点、类型和外观。
- 图面元素：区域分组、纯文本注释、链路图例及层次顺序。

分类可自定义。模板与连线支持逻辑关系，不局限地面站。内置图标为版本化组件资产，不接受任意 HTML、脚本或外部图标 URL。自定义模板目前通过名称、内置图标、参数及连接点配置，不包含自定义渲染代码。

接收端应先调用 `parseDocument()`，它校验结构、模板、绑定、坐标与连接端点，并移除未知字段。JSON Schema 可用于外部工具做结构校验；模板引用、端口类型和唯一 ID 等跨对象约束仍由解析器校验。未知文档版本或模板版本会明确报错，避免静默丢失内容。旧的单图 v1 和通用 v2 文件会迁移为 v3；已有文档 ID、时间、模板、锁定、位置和拐点保留。`parseDocument()`、`setDefinition()` 和 `getDefinition()` 的规范化定义均使用 v3。v2 草稿基准只在原本有效时重算，过期草稿不会被误标成有效，读取旧库不会立即覆盖原存档。

## v3 图面元素与兼容性

组件包版本为 `0.7.0`，支持查找、小地图、关联聚焦和子拓扑引用，包含运行时效及发布存储接口；通用文件仍为 v3，包的 `./schema` 包含全部可选扩展，`./schema/v2` 保留旧 Schema。`0.1.x` 组件不支持 v3，需配套更新，不能只将文件的版本号改回 2，否则会丢失图面内容。

`topology.elements` 是可选数组，最多 100 项，元素公共字段为 `id`、`kind`、`x`、`y`、`width`、`height`、`title`、`color` 及可选 `locked`。宽度 160–10000、高度 80–10000 px，坐标范围与节点一致。三种类型：

| kind | 附加字段 | 说明 |
| --- | --- | --- |
| `group` | `members: string[]` | 业务节点 ID；单层分组，每个节点至多属于一组，不因空间重叠自动归组 |
| `note` | `text: string`, `fontSize: number` | 最多 2000 字符纯文本，字号为 12–28 px 整数，按宽高换行并截断显示 |
| `legend` | `showStatus: boolean` | 按已用链路类型生成示意，采用该类型首条链路的外观，状态项为说明性图例 |

`topology.order` 可选；提供时须恰好包含全部节点和图面元素 ID，数组末尾在上层。区域始终在连线下方，其余节点/注释/图例按数组顺序排列。未提供时使用节点、图面元素的存储顺序。成员引用、重复归属、ID 冲突和层次完整性由解析器校验。

图面元素没有业务对象 ID、端口或实时参数，不接受宿主数据绑定，也不触发 `onNodeClick`。组锁定保护区域及成员的位置；任何成员单独锁定时阻止整个组移动。解散只移除容器，保留成员和连接。组件本身始终只读，不显示编辑选择框、锁定提示或尺寸手柄。

制作工具的 `window.stationPrototype.snapshot()` 保持 `nodes` 为业务节点，新增可选 `elements` 与 `order`。其暴露的 X6 `graph.getNodes()` 会包含图面对象，仅供制图与验证使用；业务统计应读取 `snapshot().nodes` 或组件定义的 `topology.nodes`。`onNodeClick` 仍只回调业务节点。

SVG/PNG/HTML 与独立组件使用同一套图面 SVG 内容。JSON 和 HTML 保留完整文本与分组关系；区域或注释不会进入实时数据快照，宿主参数更新不修改图面布局。

## 本地验证页

启动制作工具后打开 `/viewer.html`，可独立导入通用文件、填写宿主数据、观察节点点击回调。拓扑库的“独立预览”链接带文档 ID 和 `draft=1`，服务器模式从登录后的 API 读取有效草稿，纯浏览器模式读取同源浏览器存档；没有该参数时读取手动保存版本。展示组件本身不依赖该存档。跨软件使用请传入导出的文件。

浏览器拓扑库仍使用 `version: 1`，内部 `editing.version` 升级为 2，兼容读取旧版并在下次成功写入时保存新版；`publishing.version: 1` 保存发布记录。旧工具的草稿解析器拒绝版本 2，避免忽略并覆盖发布记录。两者属于制作工具内部存储，不属于 `.topology.json` 通用文件格式；宿主使用下文的发布接口。自动保存只改草稿，不把运行参数或模拟器状态写入文件。

节点数据增加可选的 `locked?: boolean` 字段，缺省为未锁定。解析器、JSON Schema、草稿和历史版本会保留它；旧文件无需迁移或补入默认值。较早版本的制作工具可能不保留此字段，需要保留锁定设置时请配套更新解析器和 Schema。

锁定属于制作工具的编辑状态：位置整理和节点批量删除会跳过锁定节点，参数及连接仍可编辑，副本默认解锁。独立组件始终只读，不渲染编辑锁定标记；`getDefinition()` 和 HTML 内嵌文档仍保留该字段。参数更新接口没有变化，PNG/SVG 的展示外观也不增加锁形图标。

`/viewer.html?instances=2` 用两个独立实例验证数据隔离。右侧“填入示例数据”只是一次性准备输入，点击“更新数据”才发送给第一个实例，不会自动启动模拟器。

## 查找与子拓扑导航（0.6.0）

```ts
const definitions = new Map([parent, child].map(document => [document.id, document]));
const viewer = new TopologyViewer(container, {
  definition: parent,
  navigation: true, // false 隐藏搜索和小地图，程序接口仍可用
  minimap: true,    // 初始是否展开，用户仍可切换
  onNavigate({ documentId, fromDocumentId, node }) {
    const target = definitions.get(documentId);
    if (!target) { showMessage('目标拓扑未加载'); return; }
    // 宿主可保存自己的路由/父图栈；组件不连接存储服务。
    viewer.setDefinition(target);
    viewer.setData(dataFor(documentId));
    viewer.setLinkData(linksFor(documentId));
  },
});
const results = viewer.search('DEV-001');
viewer.focus(results[0].id, true); // 定位并聚焦一跳关系
viewer.navigateToChild(results[0].id); // 触发 onNavigate
```

`search(query)` 返回最多 50 项 `{ id, kind, label, detail }`，kind 为 node/edge/element，支持忽略大小写及空格分隔条件；搜索不改变选择。`focus(id, related=false)` 返回是否找到图形，定位会更新选择，节点还会触发原 `onNodeClick`。`navigateToChild(nodeId)` 在有引用和回调时返回 true 并交给宿主处理，否则返回 false；事件副本包含 `documentId / fromDocumentId / node`，修改回调对象不改变定义。

表单使用 `node.data.childTopologyId` 关联文档 ID，只接受安全标识，不是 URL；解析拒绝指向自身。引用目标可在宿主稍后加载，因此通用文档不要求内嵌全部子图。制作工具、独立展示和静态图片用 ↗ 标记引用，旧文件不补写字段，Schema、复制、撤销和发布均保留。包含引用的文件应配套使用 0.6.0，较早工具可能忽略引用。

组件将视口、查找、聚焦及小地图状态与文档分离。用户平移、缩放或定位后不会被初始化/容器变化重新适应画布；点击“适应画布”恢复自动适配。销毁清理导航 DOM、观察器及图事件；多实例不注册全局快捷键。高度不足 240 px 时小地图自动收起，搜索仍可用；`navigation: false` 隐藏导航工具，`controls: false` 隐藏缩放栏，`dataStatus: false` 隐藏接收说明。

制作工具在当前拓扑库中进入子图并提供返回，最多保留 20 级父图的缩放、平移和选择；不移动设备或重新布线。`/viewer.html?document=ID&draft=1` 的子图读取有效草稿，不带 draft 时读取保存版本；发布预览读取子图当前发布，未发布/缺失目标显示错误并保留父图。浏览器返回支持缓存恢复，接收时效会重新检查。

导出 HTML 内置相同导航工具，并通过 `window` 上的 `topology:navigate` CustomEvent 发送同样的 detail。宿主监听事件后自行读取目标配置并调用 `setDefinition`，再发送对应数据；单文件不自动打包或请求其他子图。PNG/SVG 为静态标记，JSON/HTML 中保留 ID。

制作工具验证接口 `window.stationPrototype.search(query)` 与 `focus(id, related?)` 作用于当前图。性能检查使用独立 `bun run test:benchmark`，单 worker、真实时钟及两帧绘制等待，分别测量图形导入、拖动、组件加载与批量更新，不用合成时钟代表帧率。

## 发布存储接口（0.5.0）

`PublicationRepository` 由宿主提供持久化实现，组件不访问 localStorage 或业务服务：

```ts
import { TopologyViewer, parsePublication } from '@topology-kit/viewer';
import type { PublicationRepository } from '@topology-kit/viewer';

// repository 由宿主实现，后端需在事务内检查 expectedRevision。
declare const repository: PublicationRepository;
const record = await repository.getPublished(documentId);
if (!record) throw new Error('拓扑尚未发布');
const published = parsePublication(record);
const viewer = new TopologyViewer(container, { definition: published.document });
viewer.setData(data);
viewer.setLinkData(linkData);

// 编辑端显式发布。首次 expectedRevision 为 0；冲突应重新读取后处理。
const next = await repository.publish(draftDocument, published.revision, '更新业务连接');
// 宿主通过自己的通知机制让展示端拉取新发布。
viewer.setDefinition(next.document); // 换定义会清空运行数据，宿主重新绑定/发送。
viewer.setData(newData);
viewer.setLinkData(newLinkData);
```

接口包含 `getPublished(documentId)`、`listPublications(documentId)`、`publish(document, expectedRevision, note?)` 和 `rollback(documentId, publicationId, expectedRevision, note?)`，均返回 Promise。返回的 `TopologyPublication` 包含 `id / documentId / revision / publishedAt / note / document` 和可选 `rollbackOf`；`document` 仍是 v3。`parsePublication` 校验并规范化副本；这组元数据由发布存储管理，不添加到通用配置文件。

发布与回滚必须作为原子操作检查预期版本、写入新快照并推进版本。回滚创建单调的新版本，记录原历史 ID，不覆盖原记录；权限、审核、账号、数据库事务及跨设备通知由宿主提供。发布数据只包含配置，运行参数和接收状态继续通过独立 API 提供。

项目内 `src/publication-storage.ts` 的 `LocalPublicationRepository` 适配已有制作工具库，空库只读查询返回空结果，失败不初始化示例。它保留当前发布并限制历史容量，写入失败或冲突不推进内存；本地存储的标签页变更检测不等于后端事务。该适配器不打包进独立组件，宿主可按相同接口接入自己的服务。

本地“打开当前发布”链接为 `/viewer.html?published=文档ID`，同源展示页通过 storage 事件跟随新发布，草稿/手动保存不触发版本替换。指定 `publication=发布ID` 固定不可变历史快照，工具同时附带 `revision=N` 供辨认，接收端校验两者一致；也支持仅按版本号查找。缺失版本显示错误，不回退到草稿。删除源图会清理其本地发布，跟随页也移除旧内容。跨软件通过发布存储接口读取快照后调用 `setDefinition`；普通 JSON 导出不携带本地发布历史。

## 接收时间与断流处理（0.4.0）

```ts
const viewer = new TopologyViewer(container, {
  definition,
  freshness: { staleAfterMs: 15_000 },
});
viewer.configureFreshness({ staleAfterMs: 30_000 });

// 宿主负责连接采集服务，并将连接状态通知组件。
socket.addEventListener('close', () => viewer.setConnectionState('disconnected'));
socket.addEventListener('open', () => viewer.setConnectionState('connected'));
// 收到消息后按既有接口发送，设备与链路各自更新。
viewer.updateData(devicePatch);
viewer.updateLinkData(linkPatch);

const status = viewer.getDataStatus();
// nodes 按拓扑节点 ID 索引，links 按链路 ID 索引。
console.log(status.nodes['ant-01']);
// { phase: 'fresh', receivedAt: 1792850000000 }
```

- 默认超时 15000 毫秒，允许 100–86400000 毫秒整数，0 明确关闭自动过期。页面恢复前台时重新检查，后台标签页的定时节流不会将旧数据永久视为正常。
- `receivedAt` 是组件本机接收时间的 Unix 毫秒数，不是设备采样时间；未收到为 null。业务采样时间可作为自己的数据字段提供，不能用它伪造接收时间。
- `phase` 为 `waiting / fresh / stale / disconnected / snapshot`。等待尚无有效消息，过期为超时或重连后尚未收到新消息；设备 normal/warning/offline 与此独立。过期或连接中断时参数为 `—`，关联链路未知并停止流转，仍保留最后接收时间。实际新鲜的离线记录才使链路显示断开。
- `setData` / `setLinkData` 替换对应通道，未包含的对象恢复等待。`updateData` / `updateLinkData` 只刷新本次提供的已知对象；空补丁、空记录及非法更新不延长寿命。批量数据先校验，无效记录整体拒绝。参数按对象计时，一次有效局部更新合并该对象的已有字段，不提供每个参数单独的超时。
- `setConnectionState('disconnected')` 立即停止实时展示，`connected` 不刷新旧接收时间；已断开对象需收到新数据才恢复。数据 API 不替宿主推断连接已经恢复，宿主应在重连后显式通知。
- `getDataStatus()` 返回副本，包含 `nodes`、`links`、`connection`、`staleAfterMs` 与 `mode`（live/snapshot/simulation，组件使用前两种）。节点与链路数据互不清空；换定义清空两类运行值和接收状态，保留超时设置。销毁清理定时器与可见性监听，不影响其他实例。
- 展示组件顶部显示接收/过期/等待数量，点击节点显示接收时间，悬停可查看时间。宿主可用 `dataStatus: false` 隐藏顶部说明，并自行调用 `getDataStatus()` 展示。

导出 HTML 使用 `snapshot: true` 冻结初始数据及 `snapshotState` 中的接收状态，包含导出时已过期的节点；原始接收时间不会被打开文件的时间覆盖。可将构造选项 `snapshotState: { nodes, links }` 用于自己保存的运行快照，每项为 `{ phase, receivedAt }`。这些内容只属于展示快照，不进入 `.topology.json`。初次调用数据更新或连接状态 API 后进入实时模式，未更新对象恢复等待，之后按超时处理；空增量更新不触发切换。HTML 沿用导出时的超时设置，PNG/SVG 为静态外观。

从 0.3.x 升级时需要留意默认超时：连续展示需持续发送有效消息；静态嵌入可选择快照模式，或明确将超时设为 0。

## 制作工具中的宿主数据验证

制作工具默认使用模拟数据，每两秒采样。画布工具栏可选择“宿主数据”，清空模拟值并等待宿主更新。下面的接口仅供制作工具验证，独立组件继续使用上文的 `setData()` / `updateData()`。

```js
window.stationPrototype.setDataMode('external');
window.stationPrototype.updateTelemetry('DEV-001', {
  azimuth: 128.6,
  elevation: 42.3,
}, 'normal');
window.stationPrototype.getDataMode(); // 'external'
window.stationPrototype.configureFreshness({ staleAfterMs: 15_000 });
window.stationPrototype.setConnectionState('disconnected');
window.stationPrototype.setConnectionState('connected'); // 还需新消息恢复
window.stationPrototype.getDataStatus(); // 同样按节点 ID / 链路 ID 返回接收状态

// 主动恢复模拟数据，清空本次宿主值及采样历史。
window.stationPrototype.setDataMode('simulation');
```

`updateTelemetry()` 按节点的“业务对象 ID”匹配，参数使用模板内部的参数标识，返回匹配更新的节点数量。存在匹配设备时自动进入宿主模式；未知 ID 返回 0，不改变数据模式。参数必须是有限数值，状态为 `normal / warning / offline`，无效输入会抛错且不部分写入。

宿主数据不会被定时器覆盖，暂停模拟和离线演示在宿主模式中禁用。切换拓扑后清空当前运行值并保持数据模式；撤销和重做保留仍存在节点的运行值。页面刷新后默认回到模拟模式，宿主应重新发送数据。以上运行状态均不改变文档或撤销历史。

## 独立 HTML 文件

在制作工具的“导出拓扑”中选择 HTML，下载一个自包含文件。它内嵌当前文档、展示组件、样式和导出时的数据，可通过 `file://` 双击离线打开，也可部署到任意静态服务器，无需 CDN、原制作工具或浏览器拓扑库。

初始参数是制作工具导出时的模拟或宿主数据快照，保留当时的等待、过期和离线状态，不会自行采样。首次收到宿主更新后进入实时超时逻辑。导出页提供与展示组件相同的数据接口：

```js
// 在导出页面中，数据的业务 ID 和字段路径与原文档的绑定保持一致。
window.topologyViewer.setData({
  'DEV-001': { azimuth: 128.6, elevation: 42.3, status: 'normal' },
});
window.topologyViewer.updateData({
  'DEV-001': { azimuth: 129.1 },
});
window.addEventListener('topology:node-click', (event) => {
  console.log(event.detail.node, event.detail.source);
});
```

`setData()` 替换全部数据，`updateData()` 按业务对象合并第一层字段；嵌套对象字段更新时请传入该对象的完整值。初始数据按原绑定的嵌套路径及状态映射生成，节点 ID 与业务 ID 保持不变。

同源软件可以用 iframe 嵌入后更新它：

```html
<iframe id="topology-frame" src="./运控中心.html"
  title="运控中心拓扑" style="width:100%;height:600px;border:0"></iframe>
<script>
  const frame = document.getElementById('topology-frame');
  frame.addEventListener('load', () => {
    frame.contentWindow.topologyViewer.updateData({
      'DEV-001': { azimuth: 130.2, status: 'normal' },
    });
  });
</script>
```

跨源系统或需要更灵活数据接入时，可直接使用上文的独立组件。HTML 文件本身不包含制作、保存或模拟采集功能；JSON 文件用于返回制作工具继续编辑。

PNG 与 SVG 在同一导出窗口下载，都是导出时的静态参数、状态快照。SVG 使用纯矢量图形，无外部样式、图片或 `foreignObject`，节点标题及数值可能因目标软件的可用字体产生细微差异。

0.7.0 提供 Bun + SQLite 持久化及单管理员登录；多用户权限和实时协作仍未接入。服务器/API、登录及完整库备份导入见 [服务器说明](server.md)。服务器展示页读取登录后的共享库，当前发布每 5 秒检查更新，固定发布链接不跟随。独立 SDK、PNG/SVG 和单文件 HTML 不依赖服务器或登录。

## 组件包验证与维护

0.6.1 修正 NodeNext 声明中动态类型引用的扩展名，并移除公共图标类型对宿主图标依赖的要求；API 和 v3 文件兼容 0.6.0。工作台与组件版本统一，升级、产物检查及部署恢复见 [工程维护说明](engineering.md)。构建产物在无工作台依赖的独立目录中通过 `skipLibCheck: false` 类型检查，ESM/UMD 均使用浏览器宿主验收。宿主 HTML 使用 `<meta charset="utf-8">`，服务器应按 UTF-8 提供脚本；UMD 示例也可给 script 设置 `charset="utf-8"`。

0.6.2 修复端口改名引起的意外重排：节点覆写端口名称时保留已有 `offset`，未指定 `portSpacing` 时展示组件按这些偏移绘制；显式调整间距或布局后按等距配置绘制。字段及 v3 Schema 不变，旧的无偏移自定义端口继续等距分布。制作工具、独立组件和 HTML 导出应一起更新到此版本，保持相同的端点几何；宿主 API 不变。

## 服务器与宿主的边界（0.7.0）

服务器 API 管理拓扑定义及草稿/发布；设备采集值仍通过现有 `setData` / `updateData`、`setLinkData` / `updateLinkData` 传入，不写入文档数据库。工作台异步存储确认不改变这些宿主运行数据 API。

宿主可在自己的后端获取 `GET /api/workspace` 的 `workspace.publishing.entries`，按 `documentId` 取当前发布，再把其 `document` 交给 `TopologyViewer`；或实现已有 `PublicationRepository` 接口。接口需要登录会话，不提供匿名公开库，也不要把管理员密码放入宿主前端。跨系统部署可由业务后端代理访问，或继续用导出的发布 JSON。精确命令与冲突返回见 `shared/api.ts` 和 [服务器 API](server.md#api-与展示接入)。

服务器开发版本现已移除浏览器旧存档迁移。完整库备份使用 `POST /api/workspace/commands` 的 `importWorkspace` 命令，参数为 `{ workspace }`；原 `migrateWorkspace` 命令不再接受。客户端不自动读取旧浏览器拓扑库，未同步草稿恢复和独立组件运行数据 API 保持现有行为。
