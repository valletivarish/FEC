export const residentsFixture = [
  {
    residentId: 'resident-01',
    residentName: 'Margaret Hale',
    currentRiskState: 'NORMAL',
    latestEventType: 'vitals_event',
    latestEventDetail: 'Heart rate steady at 72 bpm',
    lastUpdated: '2026-07-02T09:15:00Z',
    activeCriticalAlertCount: 0,
    needsAcknowledgement: false,
  },
  {
    residentId: 'resident-02',
    residentName: 'Arthur Ng',
    currentRiskState: 'WARNING',
    latestEventType: 'vitals_event',
    latestEventDetail: 'Respiration rate elevated at 30 breaths/min',
    lastUpdated: '2026-07-02T09:18:00Z',
    activeCriticalAlertCount: 0,
    needsAcknowledgement: false,
  },
  {
    residentId: 'resident-03',
    residentName: 'Beatrice Adeyemi',
    currentRiskState: 'CRITICAL',
    latestEventType: 'fall_event',
    latestEventDetail: 'Fall confirmed in bedroom',
    lastUpdated: '2026-07-02T09:20:00Z',
    activeCriticalAlertCount: 1,
    needsAcknowledgement: true,
  },
];

export const historyFixture = {
  'resident-01': [
    {
      type: 'vitals_event',
      residentId: 'resident-01',
      vital: 'heartrate',
      previousState: 'WARNING',
      newState: 'NORMAL',
      value: 72,
      sdnnMs: 48.2,
      timestamp: '2026-07-02T09:15:00Z',
    },
    {
      type: 'vitals_event',
      residentId: 'resident-01',
      vital: 'heartrate',
      previousState: 'NORMAL',
      newState: 'WARNING',
      value: 135,
      sdnnMs: 44.1,
      timestamp: '2026-07-02T09:10:00Z',
    },
    {
      type: 'presence_event',
      residentId: 'resident-01',
      occupancyState: 'OCCUPIED',
      timestamp: '2026-07-02T09:05:00Z',
    },
  ],
  'resident-02': [
    {
      type: 'vitals_event',
      residentId: 'resident-02',
      vital: 'resprate',
      previousState: 'NORMAL',
      newState: 'WARNING',
      value: 30,
      sdnnMs: 22.7,
      timestamp: '2026-07-02T09:18:00Z',
    },
    {
      type: 'comfort_event',
      residentId: 'resident-02',
      issue: 'temperature',
      timestamp: '2026-07-02T09:12:00Z',
    },
  ],
  'resident-03': [
    {
      type: 'fall_event',
      residentId: 'resident-03',
      state: 'FALL_CONFIRMED',
      accelMagnitude: 130.4,
      timestamp: '2026-07-02T09:20:00Z',
    },
    {
      type: 'inactivity_alert',
      residentId: 'resident-03',
      timestamp: '2026-07-02T08:40:00Z',
    },
  ],
};

export async function mockCareWatchApi(page) {
  await page.route('**/residents', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(residentsFixture) });
    } else {
      await route.continue();
    }
  });

  for (const resident of residentsFixture) {
    await page.route(`**/residents/${resident.residentId}/history`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(historyFixture[resident.residentId] || []),
      });
    });

    await page.route(`**/residents/${resident.residentId}/acknowledge`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...resident, needsAcknowledgement: false, activeCriticalAlertCount: 0 }),
      });
    });
  }
}
