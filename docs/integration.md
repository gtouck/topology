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
import type { TopologyDocument, TelemetryData } from '@topology-kit/viewer';

export function TopologyPanel({ definition, data }: {
  definition: TopologyDocument;
  data: TelemetryData;
}) {
  const container = useRef<HTMLDivElement>(null);
  const controller = useRef<TopologyViewer | null>(null);
  const latestData = useRef(data);
  latestData.current = data;

  useEffect(() => {
    const viewer = new TopologyViewer(container.current!, { definition });
    controller.current = viewer;
    viewer.setData(latestData.current);
    return () => { viewer.destroy(); controller.current = null; };
  }, [definition]);

  useEffect(() => { controller.current?.setData(data); }, [data]);
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

没有接收到节点的数据时显示“等待数据”和 `—`，不产生演示值。离线节点参数显示 `—`，关联线缆变灰分段。恢复数据后还原文件中配置的线缆外观。更新数据不重新布局、不修改手工拐点。

## 状态外观

`0.2.1` 组件将正常、告警、离线和等待分别以绿色勾选、琥珀色提示、灰色虚线断连、蓝色点线时钟呈现。节点尺寸和端口位置不因状态变化而改变，参数更新不修改定义。

文件与宿主 API 仍只接受 `normal / warning / offline`。等待由绑定源尚未收到数据推导；清空数据时恢复等待，收到离线记录时显示真正离线。DOM 的 `data-status` 可为 `pending`，它是呈现标记，不是文件中的状态值。制作工具属性栏的“初始状态”设置默认值，宿主记录可以覆盖运行状态。

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

组件包版本为 `0.2.1`，包的 `./schema` 指向 v3，`./schema/v2` 保留旧 Schema。`0.1.x` 组件不支持 v3，需配套更新，不能只将文件的版本号改回 2，否则会丢失图面内容。

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

启动制作工具后打开 `/viewer.html`，可独立导入通用文件、填写宿主数据、观察节点点击回调。拓扑库的“独立预览”链接带文档 ID 和 `draft=1`，由验证页读取同源浏览器中的有效草稿；没有该参数时读取手动保存版本。展示组件本身不依赖该存档。跨软件使用请传入导出的文件。

浏览器拓扑库仍兼容 `version: 1`，额外的 `editing` 元数据保存草稿和有限历史。它属于制作工具内部存储，不属于 `.topology.json` 通用文件格式，不应作为宿主接口。自动保存不改变独立展示组件 API，也不把运行参数或模拟器状态写入文件。

节点数据增加可选的 `locked?: boolean` 字段，缺省为未锁定。解析器、JSON Schema、草稿和历史版本会保留它；旧文件无需迁移或补入默认值。较早版本的制作工具可能不保留此字段，需要保留锁定设置时请配套更新解析器和 Schema。

锁定属于制作工具的编辑状态：位置整理和节点批量删除会跳过锁定节点，参数及连接仍可编辑，副本默认解锁。独立组件始终只读，不渲染编辑锁定标记；`getDefinition()` 和 HTML 内嵌文档仍保留该字段。参数更新接口没有变化，PNG/SVG 的展示外观也不增加锁形图标。

`/viewer.html?instances=2` 用两个独立实例验证数据隔离。右侧“填入示例数据”只是一次性准备输入，点击“更新数据”才发送给第一个实例，不会自动启动模拟器。

## 制作工具中的宿主数据验证

制作工具默认使用模拟数据，每两秒采样。画布工具栏可选择“宿主数据”，清空模拟值并等待宿主更新。下面的接口仅供制作工具验证，独立组件继续使用上文的 `setData()` / `updateData()`。

```js
window.stationPrototype.setDataMode('external');
window.stationPrototype.updateTelemetry('DEV-001', {
  azimuth: 128.6,
  elevation: 42.3,
}, 'normal');
window.stationPrototype.getDataMode(); // 'external'

// 主动恢复模拟数据，清空本次宿主值及采样历史。
window.stationPrototype.setDataMode('simulation');
```

`updateTelemetry()` 按节点的“业务对象 ID”匹配，参数使用模板内部的参数标识，返回匹配更新的节点数量。存在匹配设备时自动进入宿主模式；未知 ID 返回 0，不改变数据模式。参数必须是有限数值，状态为 `normal / warning / offline`，无效输入会抛错且不部分写入。

宿主数据不会被定时器覆盖，暂停模拟和离线演示在宿主模式中禁用。切换拓扑后清空当前运行值并保持数据模式；撤销和重做保留仍存在节点的运行值。页面刷新后默认回到模拟模式，宿主应重新发送数据。以上运行状态均不改变文档或撤销历史。

## 独立 HTML 文件

在制作工具的“导出拓扑”中选择 HTML，下载一个自包含文件。它内嵌当前文档、展示组件、样式和导出时的数据，可通过 `file://` 双击离线打开，也可部署到任意静态服务器，无需 CDN、原制作工具或浏览器拓扑库。

初始参数是制作工具导出时的模拟数据快照，不会自动变化。导出页提供与展示组件相同的数据接口：

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

后端存储、权限和多用户协作尚未接入。
