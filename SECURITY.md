# Security

Please report vulnerabilities privately through GitHub Security Advisories for `alainux/orb` rather than filing a public issue.

Orb is intentionally capable of driving Pi, including cancelling a run, changing model/thinking/tool state, and optionally executing shell commands. These capabilities are enforced through independent permissions in Orb's configuration. Review `docs/CONFIGURATION.md` before enabling Orb in an environment where commands or project files are sensitive.

The default configuration enables the features requested for the normal local-developer experience, including shell control. If you prefer a narrower voice surface, disable individual capabilities such as `permissions.shell`, `permissions.setModel`, `permissions.setThinking`, or `permissions.setTools`.

Scratchpad file access is project-scoped by default. `scratchpadOutsideProject` must be explicitly enabled before the voice layer may load or save outside the current project. Scratchpad saves are atomic where supported.

Pi packages and shell commands execute with the permissions of the Pi process. Orb is not a sandbox. Run untrusted projects in an appropriate container/sandbox and use the minimum permissions that fit your workflow.

Normal `!` commands may become visible to the voice agent through Pi's observable session data so it can stay synchronized with direct human actions. Pi's `!!`/excluded commands remain intentionally outside model context. Hidden model reasoning is never exposed.

Run logs and provider transcripts may contain spoken text, delegated instructions, command summaries, scratchpad metadata, and project information. Protect diagnostics/log directories as you would project notes.
