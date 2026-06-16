# AI Coder

> Python 智能体助手 —— 基于 **GenericAgent** 多轮工具调用框架，支持多 LLM Provider、流式输出、插件式扩展。
> 后期将引入 **ReMe** 优化长上下文与记忆管理。

> **历史：** 旧版本为 TypeScript 实现，入口 `./dist/cli.js`（Ink TUI）。当前版本已迁移到 Python，TS 代码仅作存档。

---

## Quick Start

```bash
# 1. 激活虚拟环境（项目根目录下）
source .venv/bin/activate

# 2. 配置 LLM Key（首次运行会引导生成配置）
vim mykey.py

# 3. 启动 GenericAgent 交互式 REPL
python agents.py

# 4. 或直接传入 prompt 一次性执行
python agents.py --input "解释一下 Python 的 asyncio"
```

进入 REPL 后看到 `✦ GenericAgent` 提示符即可开始对话。键入 `/exit` 退出，`Ctrl+C` 中断当前请求。

---

## Providers

通过 `assets/configure_mykey.py` 写入配置，或在 `mykey.py` / 环境变量中设置：

| Provider  | 环境变量                | 备注                                |
| --------- | --------------------- | --------------------------------- |
| Anthropic | `ANTHROPIC_API_KEY`   | 默认 provider                          |
| OpenAI    | `OPENAI_API_KEY`      | GPT-4o / o 系列                          |
| OpenRouter| `OPENROUTER_API_KEY`  | 统一网关，可调用各厂商模型                  |
| Ollama    | —                     | 本地模型，无需 key                       |

> 模型选择与切换在配置文件中维护，详见 `llmcore.py` 中的 `resolve_client`。

---

## Commands

```bash
# 交互式 REPL（默认）
python agents.py

# 一次性任务（指定 input）
python agents.py --input "Your question"

# 详细模式（打印每轮 LLM 推理过程）
python agents.py --verbose

# 选择第 N 个 LLM 配置（多 key 场景）
python agents.py --llm_no 1

# 一次性任务，跑在后台（输出写入 temp/<task>/stdout.log）
python agents.py --task my_task --input "..."

# 反射模式：加载监控脚本，check() 触发时发任务
python agents.py --reflect path/to/script.py
```

---

## 内置工具

工具定义在 `assets/tools_schema.json`（OpenAI function-calling 格式），由 `GenericAgentHandler` 实现：

| 工具                       | 用途                                |
| ------------------------ | --------------------------------- |
| `code_run`               | 执行 Python / Bash / PowerShell       |
| `file_read`              | 读取文件（支持行号 / 关键字过滤）            |
| `file_patch`             | 字符串级文件补丁                          |
| `file_write`             | 写入文件                              |
| `web_scan`               | 扫描 / 切换浏览器标签，提取网页文本          |
| `web_execute_js`         | 在当前页面注入并执行 JS                    |
| `update_working_checkpoint` | 写入工作记忆 checkpoint              |
| `ask_user`               | 多候选向用户提问                          |
| `start_long_term_update` | 触发长程记忆 / 反思流程                    |

---

## Architecture

```
ai-coder/
├── agents.py              # 入口：GenericAgent 类 + CLI (argparse)
├── ga.py                  # GenericAgentHandler：工具实现 / 格式化 / 工具循环
├── agent_loop.py          # AgentRunnerLoop 框架：BaseHandler / StepOutcome / Hook 触发
├── llmcore.py             # Provider 抽象、消息编解码、ToolClient / NativeSession
├── mykey.py               # Key & 模型配置（运行时由 configure_mykey.py 生成）
├── plugins/               # 零侵入扩展点
│   ├── hooks.py           #   事件注册器 (agent_before / turn_before / tool_before …)
│   ├── project_mode.py    #   项目模式：L1（每轮注入规则）+ L2（按需读取的 project_memory.md）
│   └── langfuse_tracing.py#   LLM 调用追踪（Langfuse）
├── memory/                # L2 持久化记忆
│   ├── global_mem.txt
│   └── global_mem_insight.txt
├── assets/                # 工具 schema / 系统 prompt / 配置脚本 / CDP 桥
├── temp/                  # 临时工作区、模型响应、长程任务日志
└── .venv/                 # Python 3.13 virtualenv
```

### 关键流程

1. `agents.py` 启动 → 创建 `GenericAgent` 实例 → 加载 `plugins/hooks.py` 下的所有插件
2. 用户输入 → `agent_runner_loop`（`agent_loop.py`）驱动多轮
3. 每轮：触发 `llm_before` hook → 调用 LLM → 解析 tool_calls → 触发 `tool_before` / `tool_after` → 把结果回填到 messages
4. 工具由 `GenericAgentHandler.dispatch` 路由到 `do_<tool_name>` 方法
5. 退出条件：LLM 不再发起 tool_call，或达到 `max_turns`

---

## 记忆系统

两层结构，由 `plugins/project_mode.py` 实现：

- **L1（规则 + 指针）**：每轮全量注入到 `messages[-1]`。轻量、稳定。
- **L2（记忆全文）**：`temp/projects/<project>/project_memory.md` 不注入，模型按 L1 指针用 `file_read` 按需读取。

激活态用 `temp/.active_project.<pid>` 文件锚（PID 键控，多进程互不干扰）。

---

## Roadmap

- [ ] **ReMe 集成** —— 引入基于检索的外部记忆库（vector store / BM25），自动从长对话 / 历史 session 中召回相关上下文，缓解 L2 单文件全文读写的局限。计划接入点：`llm_before` hook 注入 recalled context；`start_long_term_update` 工具触发写入。
- [ ] 项目模式多项目并行
- [ ] 更多 Provider 适配
- [ ] TypeScript 版本（`./dist/cli.js`）下线清理

---

## License

MIT
