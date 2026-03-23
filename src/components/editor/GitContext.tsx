import type { GitInfo } from '../../lib/git';

interface GitContextProps {
  gitInfo: GitInfo | null;
}

function GitContext({ gitInfo }: GitContextProps) {
  if (!gitInfo) return null;

  const { branch, is_dirty, ahead, behind } = gitInfo;

  const statusIcon = is_dirty ? '\u25CF' : '\u2713';
  const statusClass = is_dirty ? 'git-status-dirty' : 'git-status-clean';

  return (
    <span className="git-context" data-testid="git-context">
      <span className="git-branch" data-testid="git-branch">[{branch}]</span>
      {ahead > 0 && <span className="git-ahead" data-testid="git-ahead">{'\u2191'}{ahead}</span>}
      {behind > 0 && <span className="git-behind" data-testid="git-behind">{'\u2193'}{behind}</span>}
      <span className={`git-status ${statusClass}`} data-testid="git-status">{statusIcon}</span>
    </span>
  );
}

export default GitContext;
