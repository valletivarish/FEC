'use strict';

const MIN = 0;
const MAX = 6;
const OCCLUSION_MIN = 0;
const OCCLUSION_MAX = 40;

// bounded by the 6 real bays; occlusionPercent rides alongside as context for how trustworthy the count is
function nextValue(_previousValue) {
  const count = Math.round(MIN + Math.random() * (MAX - MIN));
  const occlusionPercent = Math.round(OCCLUSION_MIN + Math.random() * (OCCLUSION_MAX - OCCLUSION_MIN));
  return { count, occlusionPercent };
}

module.exports = { nextValue, MIN, MAX, OCCLUSION_MIN, OCCLUSION_MAX };
