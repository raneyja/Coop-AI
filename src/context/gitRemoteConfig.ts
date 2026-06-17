export function parseGithubRemoteFromGitConfig(config: string): { owner: string; repo: string } | undefined {
  const originBlock = config.match(/\[remote "origin"\][\s\S]*?(?=\[|$)/i);
  const searchText = originBlock?.[0] ?? config;
  const urlMatch = searchText.match(/url\s*=\s*(.+)/i);
  if (!urlMatch) {
    return undefined;
  }
  const url = urlMatch[1].trim();
  const ssh = url.match(/git@github\.com:([^/]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (ssh) {
    return { owner: ssh[1], repo: ssh[2] };
  }
  const https = url.match(/github\.com\/([^/]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (https) {
    return { owner: https[1], repo: https[2] };
  }
  return undefined;
}

export function parseGitlabRemoteFromGitConfig(config: string): { owner: string; repo: string } | undefined {
  const originBlock = config.match(/\[remote "origin"\][\s\S]*?(?=\[|$)/i);
  const searchText = originBlock?.[0] ?? config;
  const urlMatch = searchText.match(/url\s*=\s*(.+)/i);
  if (!urlMatch) {
    return undefined;
  }
  const url = urlMatch[1].trim();
  const ssh = url.match(/git@([^:]+):(.+?)(?:\.git)?$/i);
  if (ssh) {
    const segments = ssh[2].split("/").filter(Boolean);
    if (segments.length >= 2) {
      return { owner: segments[0], repo: segments[segments.length - 1] };
    }
  }
  const https = url.match(/gitlab[^/]*\/(.+?)(?:\.git)?$/i);
  if (https) {
    const segments = https[1].split("/").filter(Boolean);
    if (segments.length >= 2) {
      return { owner: segments[0], repo: segments[segments.length - 1] };
    }
  }
  return undefined;
}

export function parseBitbucketRemoteFromGitConfig(config: string): { owner: string; repo: string } | undefined {
  const originBlock = config.match(/\[remote "origin"\][\s\S]*?(?=\[|$)/i);
  const searchText = originBlock?.[0] ?? config;
  const urlMatch = searchText.match(/url\s*=\s*(.+)/i);
  if (!urlMatch) {
    return undefined;
  }
  const url = urlMatch[1].trim();
  const ssh = url.match(/git@bitbucket\.org:([^/]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (ssh) {
    return { owner: ssh[1], repo: ssh[2] };
  }
  const https = url.match(/bitbucket\.org\/([^/]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (https) {
    return { owner: https[1], repo: https[2] };
  }
  return undefined;
}
