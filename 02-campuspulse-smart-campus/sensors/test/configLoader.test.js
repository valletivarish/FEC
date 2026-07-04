const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadConfig, applyEnvOverrides, validate, topicToEnvSegment } = require("../../config/configLoader");

const REAL_CONFIG_PATH = path.join(__dirname, "..", "..", "config", "sensors.campuspulse.yml");

function writeTempConfig(yamlContent) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "campuspulse-config-"));
  const filePath = path.join(dir, "sensors.test.yml");
  fs.writeFileSync(filePath, yamlContent, "utf8");
  return filePath;
}

describe("configLoader", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("parses the real YAML config into sensors and zones", () => {
    const { sensors, zones } = loadConfig(REAL_CONFIG_PATH);

    expect(zones).toEqual(["zone-a", "zone-b", "zone-c"]);
    expect(sensors.electricity).toEqual({ sampleFrequencyMs: 5000, dispatchRateMs: 60000 });
    expect(sensors["door-contact"]).toEqual({ sampleFrequencyMs: 1000, dispatchRateMs: 5000 });
  });

  test("topicToEnvSegment converts hyphenated topics to env-safe segments", () => {
    expect(topicToEnvSegment("hvac-duct-pressure")).toBe("HVAC_DUCT_PRESSURE");
    expect(topicToEnvSegment("co2")).toBe("CO2");
  });

  test("env var override wins over the file value", () => {
    process.env.CAMPUSPULSE_SENSOR_ELECTRICITY_FREQUENCY_MS = "1234";
    process.env.CAMPUSPULSE_SENSOR_ELECTRICITY_DISPATCH_MS = "9999";

    const { sensors } = loadConfig(REAL_CONFIG_PATH);

    expect(sensors.electricity).toEqual({ sampleFrequencyMs: 1234, dispatchRateMs: 9999 });
  });

  test("applyEnvOverrides leaves topics without env vars untouched", () => {
    const resolved = applyEnvOverrides({
      temperature: { sampleFrequencyMs: 10000, dispatchRateMs: 30000 },
    });

    expect(resolved.temperature).toEqual({ sampleFrequencyMs: 10000, dispatchRateMs: 30000 });
  });

  test("validate throws a clear error when dispatchRateMs < sampleFrequencyMs", () => {
    expect(() =>
      validate({ electricity: { sampleFrequencyMs: 5000, dispatchRateMs: 1000 } })
    ).toThrow(/dispatchRateMs \(1000\) must be >= sampleFrequencyMs \(5000\)/);
  });

  test("loadConfig throws when the file defines an invalid sensor block", () => {
    const badConfigPath = writeTempConfig(
      "sensors:\n  co2:\n    sampleFrequencyMs: 10000\n    dispatchRateMs: 5000\nzones:\n  - zone-a\n"
    );

    expect(() => loadConfig(badConfigPath)).toThrow(/dispatchRateMs/);
  });
});
