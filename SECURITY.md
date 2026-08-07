# Security

Please report vulnerabilities privately through GitHub Security Advisories for `alainux/orb` rather than filing a public issue.

Orb itself gives the realtime voice model only three narrow capabilities: delegate a text task to Pi, read visible Pi activity, and wait for Pi. It does **not** expose arbitrary shell, filesystem, or Pi tool execution directly to the voice provider.

Pi packages execute with the permissions of the Pi process. Review Pi's own security model and run untrusted projects in an appropriate sandbox or container.

Run logs may include spoken transcripts and high-level delegated task text. Protect the log directory as you would project notes.
