# SICO i18n Glossary — zh-CN (Simplified Chinese)

Approved terminology and tone for translating the Lingui catalog into `zh-CN`.
Every translation MUST use these renderings for the listed terms so the product
reads consistently.

## Tone

- **Formal, professional**. No slang, no exclamation marks unless the source has one.
- **UI controls**: concise verb or noun phrases with no trailing period.
- **Sentences**: complete sentences ending with the full-width period `。`.
- Use **full-width punctuation** for Chinese prose.
- Address the user as **你**, not 您.
- Put one space between Chinese text and adjacent half-width Latin text or numbers.
- Keep Chinese UI copy concise rather than translating word for word.

## Term table

| English           | 中文         | Notes                                           |
| ----------------- | ------------ | ----------------------------------------------- |
| Digital Worker    | 数字员工     | Core product concept.                           |
| Agent             | 数字员工     | Use 智能体 only for the abstract agent concept. |
| Project           | 项目         |                                                 |
| Asset             | 资产         |                                                 |
| Knowledge         | 知识         | Knowledge file/document = 知识文件 / 知识文档   |
| Deliverable       | 交付物       |                                                 |
| Experience        | 经验         |                                                 |
| Sandbox           | 沙箱         |                                                 |
| Device            | 设备         |                                                 |
| Plan              | 计划         |                                                 |
| Task              | 任务         |                                                 |
| Subtask           | 子任务       |                                                 |
| Project member(s) | 项目成员     |                                                 |
| Workforce         | 数字员工团队 |                                                 |
| Preview           | 预览         |                                                 |
| Download          | 下载         |                                                 |
| Upload            | 上传         |                                                 |
| Retry / Try again | 重试         |                                                 |
| Cancel            | 取消         |                                                 |
| Delete            | 删除         |                                                 |
| Save              | 保存         |                                                 |
| Edit              | 编辑         |                                                 |
| View              | 查看         |                                                 |
| Add               | 添加         |                                                 |
| Loading…          | 加载中…      | Use full-width ellipsis.                        |
| Email             | 邮箱         |                                                 |
| Password          | 密码         |                                                 |
| SICO              | SICO         | Brand name; never translate.                    |

## Placeholder and escaping rules

- Copy interpolation tokens such as `{0}`, `{failed}`, and `{count}` verbatim.
- Preserve escapes such as `\"` and `\n`.
- Convert straight quotes around placeholders to Chinese curly quotes where appropriate.
- Do not translate code spans, URLs, or file extensions.
