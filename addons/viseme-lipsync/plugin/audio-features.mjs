export function normalizeOpenness(rms, noiseFloor, speechCeiling) {
  const range = Math.max(0.000001, speechCeiling - noiseFloor);
  return Math.min(1, Math.max(0, (rms - noiseFloor) / range));
}

export function shouldDeferVowelToCalibration(visemeId, templates) {
  const completeCalibration = ['open', 'wide', 'round'].every(shape =>
    Array.isArray(templates?.[shape]) && templates[shape].length > 0
  );
  return completeCalibration && Number.isInteger(visemeId) && visemeId >= 0 && visemeId <= 4;
}

export function classifyMfcc(vector, templates) {
  if (!vector || !templates) return null;
  let bestShape = null;
  let bestDistance = Infinity;

  for (const [shape, candidates] of Object.entries(templates)) {
    for (const candidate of candidates) {
      if (!Array.isArray(candidate) || candidate.length !== vector.length) continue;
      let distance = 0;
      for (let index = 0; index < vector.length; index++) {
        const difference = vector[index] - candidate[index];
        distance += difference * difference;
      }
      if (distance < bestDistance) {
        bestDistance = distance;
        bestShape = shape;
      }
    }
  }
  return bestShape;
}

export function medianTemplate(frames) {
  if (!Array.isArray(frames) || !frames.length) return null;
  const width = frames[0].length;
  const median = new Array(width);

  for (let index = 0; index < width; index++) {
    const column = frames.map(frame => frame[index]).sort((a, b) => a - b);
    median[index] = column[Math.floor(column.length / 2)];
  }

  const norm = Math.sqrt(median.reduce((sum, value) => sum + value * value, 0)) || 1;
  return median.map(value => value / norm);
}

// Adapted from JagTheHero/VTuberAvatarStudio's MIT-licensed MFCC runtime.
export function createMfccExtractor(sampleRate, fftSize) {
  const melBands = 24;
  const coefficientCount = 12;
  const binCount = fftSize / 2;
  const hzToMel = frequency => 2595 * Math.log10(1 + frequency / 700);
  const melToHz = mel => 700 * (Math.pow(10, mel / 2595) - 1);
  const minMel = hzToMel(80);
  const maxMel = hzToMel(Math.min(7600, sampleRate / 2));
  const centers = [];

  for (let index = 0; index < melBands + 2; index++) {
    const frequency = melToHz(minMel + (maxMel - minMel) * index / (melBands + 1));
    centers.push(frequency / (sampleRate / 2) * (binCount - 1));
  }

  const filterBank = [];
  for (let index = 0; index < melBands; index++) {
    const [low, center, high] = [centers[index], centers[index + 1], centers[index + 2]];
    const weights = new Float32Array(binCount);
    for (let bin = Math.floor(low); bin <= Math.min(Math.ceil(high), binCount - 1); bin++) {
      if (bin >= low && bin <= center && center > low) {
        weights[bin] = (bin - low) / (center - low);
      } else if (bin > center && bin <= high && high > center) {
        weights[bin] = (high - bin) / (high - center);
      }
    }
    filterBank.push(weights);
  }

  const dct = [];
  for (let coefficient = 1; coefficient <= coefficientCount; coefficient++) {
    const row = new Float32Array(melBands);
    for (let band = 0; band < melBands; band++) {
      row[band] = Math.cos(Math.PI * coefficient * (2 * band + 1) / (2 * melBands));
    }
    dct.push(row);
  }

  return frequencyDb => {
    const logMel = new Float32Array(melBands);
    for (let band = 0; band < melBands; band++) {
      let energy = 1e-10;
      for (let bin = 0; bin < binCount; bin++) {
        energy += filterBank[band][bin] * Math.pow(10, frequencyDb[bin] / 10);
      }
      logMel[band] = Math.log10(energy);
    }

    const vector = new Array(coefficientCount);
    let squaredNorm = 0;
    for (let coefficient = 0; coefficient < coefficientCount; coefficient++) {
      let value = 0;
      for (let band = 0; band < melBands; band++) {
        value += dct[coefficient][band] * logMel[band];
      }
      vector[coefficient] = value;
      squaredNorm += value * value;
    }

    const norm = Math.sqrt(squaredNorm) || 1;
    return vector.map(value => value / norm);
  };
}
