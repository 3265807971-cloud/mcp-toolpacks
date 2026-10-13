# 数据格式

[English](SPEC.en.md) · [返回 README](README.md)

这个仓库里只有两种东西：**你写的**（包表）和**客户端告诉你的**（状态）。规格都很小。

---

## 一、你写的：包表

一个包就是**一组按用途命名的工具引用**。

```jsonc
{
  "id": "code",                       // 必填。稳定标识，也是你持久化「哪些包开着」时用的键
  "title": "Reading code",            // 必填。卡片上那行大字
  "desc": "找文件、搜索、看历史",        // 选填。卡片上那行小字
  "note": "……",                       // 选填。展开时才显示的那句脚注

  "localTools": ["clipboard"],        // 选填。客户端自己的工具（不是任何 MCP 服务器给的）

  "mcpTools": {                       // 选填。服务器名 → 这台服务器上、这个包要开的工具名
    "github":     ["get_file", "search_code", "list_commits"],
    "filesystem": ["read_file", "list_directory"]
  }
}
```

### 字段说明

| 字段 | 必填 | 说明 |
|---|:--:|---|
| `id` | ✅ | 改了等于换了一个包。UI 里映射图标也是用它 |
| `title` | ✅ | |
| `desc` | | 一句话说清这堆是干什么的 |
| `note` | | 脚注。适合写「这个包会改东西，小心」这类提醒 |
| `localTools` | | **只列要开的**。没有客户端工具就整个字段留空 |
| `mcpTools` | | 键是**服务器名**，值是**工具名数组** |

### 🚨 `mcpTools` 的三条规矩

1. **只列要开的**，不列「别开的」。
   语义是**累加**：开这个包时只把列到的打开，其余工具交给并集算法处理（见下）。

2. **服务器名写错一个字，这个包静默失效。**
   包是按**名字**找服务器的。改名、删除都会让它失效 —— `validate()` 会把这种包报成 `missingServers`，请务必显示给用户看。

3. **`mcpTools` 里最好别提服务器上的所有工具。**
   如果某个包把一台服务器上的工具**全都要了**，那其实说明「开这台服务器」就是你要的语义 —— 这仍然能工作，只是失去意义了。

### 关于「关闭名单」

包表之外，你还需要一份**显式的关闭名单**：

```ts
const DISABLED: DisabledTools = {
  github: ['list_notifications', 'mark_notification_read'],
}
```

格式就是 `{ 服务器名: [工具名] }`。

**为什么必须有它：** 因为并集算法是**覆盖式**的 —— 被包盖住的服务器上，没被任何包点名的工具会被强制关掉。所以「哪个包也没提它」＝「默默关掉」。这份名单让「关着」这件事变成**被写下来的**，而不是**被推断出来的**。

> 每条都要配一个理由。写在代码注释里。理由是关于未来的自己的 —— 三个月后没人分得清那是决定还是疏漏。

---

## 二、客户端告诉你的：状态

```ts
interface ToolState   { name: string; enable: boolean }

interface ServerState {
  name: string                 // 包就是按这个名字找它的
  tools: ToolState[]           // 你上一次 tools/list 拿到的缓存
}

interface AppState {
  localTools: string[]         // 现在开着的客户端工具
  attached: string[]           // 现在挂在这个助手身上的服务器（按名字）
  servers: ServerState[]       // 你知道的所有服务器
}
```

### 两处需要注意的地方

**`servers[].tools` 是缓存，不是实时的。**
它是你上一次 `tools/list` 的结果。**这份缓存过期，是第 3 条那个事故的根因。** 别把它当成真相。

**`attached` 按服务器名索引。**
如果你的客户端内部用 UUID 认服务器（很多都这样），那在你自己的模型里保留 UUID，在这个 `AppState` 的适配层里做一次 name ↔ id 映射就行。

---

## 三、`resolve(state, packs, packId, enable)`

切换一个包。**纯函数**：不改动传入的 `state`，返回一整份新状态。

```ts
interface ResolveResult {
  state: AppState
  blocked?: { server: string; missing: string[] }[]   // 非空 = 什么都没动
}
```

### 行为契约

1. **守卫。** 若 `enable` 为真、且 `unavailable(state, pack)` 非空 ⇒ **原样返回 `state`**，`blocked` 填上缺了哪些名字。
   *关闭方向不设防* —— 关闭必须永远可用。
2. **本地工具**：开启时取并集，关闭时差集。
3. **算开着的包**：`packs.filter(p => isOn(state, p))`，再按 `enable` 加上/去掉 `packId`。
   注意这一步算的是**改动之前**的 `state`。
4. **只碰 `pack.mcpTools` 点名的服务器。** 其余的 `ServerState` 原样返回。
5. **对每台被点名的服务器**：该开的 = 所有「在开着的包里、且碰这台服务器」的工具的**并集**；不在并集里的一律设 `enable: false`。
6. **摘除**：被点名过、且现在一个启用工具都不剩的服务器，从 `attached` 里去掉。反过来，有启用工具的加进 `attached`。

> 第 5 步意味着「覆盖」：这台服务器上手工开过的、没被任何包点名的工具会被关掉。这是设计如此。

### 幂等

对同一个 `packId` 连续 `resolve(..., true)` 两次，第二次的结果与第一次相同。

---

## 四、`isOn(state, pack)`

```ts
isOn(state, pack): boolean
```

**包开着 ⟺ 它的成员全都开着。**

- 每个 `localTools` 成员都在 `state.localTools` 里；
- 每个 `mcpTools` 点名的服务器都**存在**、**在 `attached` 里**，且它点名的工具全都 `enable`。

判据里出现「服务器不存在 ⇒ 判为关」，所以一台被改名的服务器会让那个包**永远开不起来**，而且看起来只是「关着」。
⇒ 这种情况必须由 `validate().missingServers` 报到 UI 上。

**这个值是算出来的，永远不要存。**

---

## 五、`validate(state, packs, disabled?)`

```ts
interface ValidationReport {
  unassigned:     Record<string, string[]>   // 没被任何包认领、也不在关闭名单里的工具
  unavailable:    Record<string, string[]>   // 包里引用了、服务器上暂时没有的
  missingServers: Record<string, string[]>   // 包里点名了、但整台服务器都找不到的
}
```

| 字段 | 含义 | 该怎么办 |
|---|---|---|
| `unassigned` | **会被默默关掉的那批** | 写测试钉死它为空。非空＝有工具正在无声失效 |
| `unavailable` | 缓存过期，或服务器端改了工具名 | 让用户先同步一次；`resolve()` 也会因此拒绝执行 |
| `missingServers` | 服务器被改名/删了 | 显示在卡片上。这种包永远开不起来 |

`unassigned` 是这三个里唯一一个**应该永远为空**的。
