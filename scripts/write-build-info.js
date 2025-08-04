const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function getGitInfo() {
  const commitId = execSync('git rev-parse --short HEAD').toString().trim();
  const commitMessage = execSync('git log -1 --pretty=%s').toString().trim();
  return { commitId, commitMessage };
}

function writeBuildInfo() {
  try {
    const info = getGitInfo();
    const outputPath = path.resolve(__dirname, '../webapp/public/build-info.json');
    fs.writeFileSync(outputPath, JSON.stringify(info, null, 2));
    console.log('Build info written to', outputPath);
  } catch (err) {
    console.error('Failed to write build info', err);
    process.exit(1);
  }
}

writeBuildInfo();
