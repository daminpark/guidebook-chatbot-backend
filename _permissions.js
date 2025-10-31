// This file defines which booking keys have permission to control which entities.
// It is the backend's secure source of truth.

export const permissions = {
  "31": { "climate": ["climate.3_1_trv"] },
  "32": { "climate": ["climate.3_2_trv"] },
  "33": { "climate": ["climate.3_c_trv", "climate.3_3_trv"] },
  "34": { "climate": ["climate.3_4_trv"] },
  "35": { "climate": ["climate.3_5_trv"] },
  "36": { "climate": ["climate.3_6_trv"] },
  "3a": { "climate": ["climate.3_1_trv", "climate.3_2_trv"] },
  "3b": { "climate": ["climate.3_4_trv", "climate.3_5_trv", "climate.3_6_trv"] },
  "51": { "climate": ["climate.5_1_trv"] },
  "52": { "climate": ["climate.5_2_trv"] },
  "53": { "climate": ["climate.5_c_trv", "climate.5_3_trv"] },
  "54": { "climate": ["climate.5_4_trv"] },
  "55": { "climate": ["climate.5_5_trv"] },
  "56": { "climate": ["climate.5_6_trv"] },
  "5a": { "climate": ["climate.5_1_trv", "climate.5_2_trv"] },
  "5b": { "climate": ["climate.5_4_trv", "climate.5_5_trv", "climate.5_6_trv"] },
  "193vbr": { "climate": ["climate.3_1_trv", "climate.3_2_trv", "climate.3_3_trv", "climate.3_c_trv", "climate.3_4_trv", "climate.3_5_trv", "climate.3_6_trv"] },
  "195vbr": { "climate": ["climate.5_1_trv", "climate.5_2_trv", "climate.5_3_trv", "climate.5_c_trv", "climate.5_4_trv", "climate.5_5_trv", "climate.5_6_trv"] }
};