// One slot chip per desired task; filled chips (up to runningCount) show the fleet is actually up.
export function renderScalingStatusCard(containerEl, scalingStatus) {
  const desiredCount = scalingStatus?.desiredCount ?? 0;
  const runningCount = scalingStatus?.runningCount ?? 0;

  const slotCells = Array.from({ length: desiredCount }, (_, index) => {
    const isRunning = index < runningCount;
    const label = isRunning ? 'up' : 'pending';
    return `<span class="officeiq-fleet-cell${isRunning ? ' is-running' : ''}" title="task ${index + 1}: ${label}"></span>`;
  }).join('');

  containerEl.innerHTML = `
    <div class="card">
      <div class="card-body">
        <h3 class="card-title h6">ECS Fargate Worker Fleet</h3>
        <p class="officeiq-fleet-count mb-2">${runningCount} / ${desiredCount} tasks running</p>
        <div class="officeiq-fleet-row">${slotCells || '<span class="text-muted">No task data available</span>'}</div>
      </div>
    </div>
  `;
}
