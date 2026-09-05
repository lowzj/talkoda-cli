// Starter only: rewrite the motif and arrangement for the requested conversation.
// Strudel 1.3.0; 4/4; all sounds are built-in synths.
setcps(108 / 60 / 4);

const motif = note("<[a4 ~ c5 e5] [g4 ~ b4 d5] [f4 a4 c5 ~] [e4 ~ g4 b4]>")
  .s("triangle")
  .attack(0.01)
  .decay(0.2)
  .sustain(0.1)
  .release(0.2)
  .gain(0.18)
  .room(0.15);

const harmony = note("<[a3,c4,e4] [g3,b3,d4] [f3,a3,c4] [e3,g3,b3]>")
  .s("sawtooth")
  .lpf(750)
  .attack(0.2)
  .release(0.5)
  .gain(0.08);

const bass = note("<a2 g2 f2 e2>").s("sine").decay(0.3).sustain(0).gain(0.22);
const pulse = s("white*8").hpf(7000).decay(0.02).sustain(0).gain(0.04);

arrange(
  [8, motif],
  [16, stack(motif, harmony, bass)],
  [8, stack(motif.rev(), harmony)],
  [24, stack(motif, harmony, bass, pulse)],
  [8, stack(motif.slow(2), harmony)],
);
