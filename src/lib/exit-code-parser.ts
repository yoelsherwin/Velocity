import { ShellType } from './types';

/** Match the exit marker only when it starts at the beginning of a line. */
const EXIT_CODE_REGEX = /^VELOCITY_EXIT:(-?\d+)\r?$/m;

/** Global variant used for stripping all marker occurrences from output. */
const EXIT_CODE_STRIP_REGEX = /^VELOCITY_EXIT:(-?\d+)\r?\n?/gm;

/**
 * Extract an exit code marker from accumulated PTY output.
 *
 * The marker format is `VELOCITY_EXIT:<code>` on its own line.
 * If found, strips the marker from the output and returns the parsed exit code.
 * If not found, returns the output unchanged with exitCode null.
 */
export function extractExitCode(output: string): { cleanOutput: string; exitCode: number | null } {
  const match = output.match(EXIT_CODE_REGEX);
  if (match) {
    const exitCode = parseInt(match[1], 10);
    const cleanOutput = output.replace(EXIT_CODE_STRIP_REGEX, '');
    return { cleanOutput, exitCode };
  }
  return { cleanOutput: output, exitCode: null };
}

/**
 * Get the shell-specific command suffix that echoes the exit code marker.
 *
 * This is appended to the user's command before sending to the PTY,
 * so the output stream contains a parseable exit code.
 */
export function getExitCodeMarker(shellType: ShellType): string {
  switch (shellType) {
    case 'powershell':
      return '; if ($?) { Write-Output "VELOCITY_EXIT:0" } else { Write-Output "VELOCITY_EXIT:1" }';
    case 'cmd':
      return '& echo VELOCITY_EXIT:%ERRORLEVEL%';
    case 'wsl':
      return '; echo "VELOCITY_EXIT:$?"';
  }
}
