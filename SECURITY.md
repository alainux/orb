# Security

Please report vulnerabilities privately through GitHub Security Advisories for `alainux/orb` rather than filing a public issue.

Orb is intentionally capable of driving Pi, including cancelling a run. Cancellation is the voice layer's **only** control surface: it calls `ctx.abort()` on the active delegated Pi task and is enforced through the `permissions.cancelPi` permission. There is deliberately **no** shell execution, model switching, or thinking/tool reconfiguration: the broad `control_pi`/`set_voice`/shell/`set_thinking`/`set_tools`/`set_model` capabilities were removed. Review `docs/CONFIGURATION.md` before enabling Orb in an environment where commands or project files are sensitive.

The default configuration enable permissions for the normal local-developer experience, including cancellation (`permissions.cancelPi: true`). If you prefer a narrower voice surface, disable `permissions.cancelPi`; there are no shell/model/thinking/tool controls left to disable because they no longer exist.

Scratchpad file access is project-scoped by default. `scratchpadOutsideProject` must be explicitly enabled before the voice layer may load or save outside the current project. Scratchpad saves are atomic where supported.

Pi packages and shell commands execute with the permissions of the Pi process. Orb is not a sandbox. Run untrusted projects in an appropriate container/sandbox and use the minimum permissions that fit your workflow.

Normal `!` commands may become visible to the voice agent through Pi's observable session data so it can stay synchronized with direct human actions. Pi's `!!`/excluded commands remain intentionally outside model context. Hidden model reasoning is never exposed.

Run logs and provider transcripts may contain spoken text, delegated instructions, command summaries, scratchpad metadata, and project information. Protect diagnostics/log directories as you would project notes.
