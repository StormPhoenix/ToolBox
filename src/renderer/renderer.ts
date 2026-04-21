async function init(): Promise<void> {
  const infoContainer = document.getElementById('app-info');
  if (!infoContainer) return;

  try {
    const info = await window.electronAPI.getAppInfo();

    infoContainer.innerHTML = `
      <div class="info-card">
        <div class="info-item">
          <span class="label">应用名称</span>
          <span class="value">${info.name}</span>
        </div>
        <div class="info-item">
          <span class="label">版本</span>
          <span class="value">${info.version}</span>
        </div>
        <div class="info-item">
          <span class="label">Electron</span>
          <span class="value">${info.electronVersion}</span>
        </div>
        <div class="info-item">
          <span class="label">Node.js</span>
          <span class="value">${info.nodeVersion}</span>
        </div>
        <div class="info-item">
          <span class="label">平台</span>
          <span class="value">${info.platform}</span>
        </div>
      </div>
    `;
  } catch (error) {
    infoContainer.textContent = '获取应用信息失败';
    console.error(error);
  }
}

document.addEventListener('DOMContentLoaded', init);
