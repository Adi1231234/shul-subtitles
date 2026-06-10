import sys, os, json, wave
import numpy as np
import onnxruntime as ort
import onnx_asr

AUDIO = sys.argv[1]
OUT_JSON = sys.argv[2]
CHOICE = sys.argv[3] if len(sys.argv) > 3 else "parakeet"

MODELS = {"parakeet": "nemo-parakeet-tdt-0.6b-v2", "canary": "nemo-canary-1b-v2"}
MODEL = MODELS.get(CHOICE, "nemo-parakeet-tdt-0.6b-v2")

# Packaged build passes a bundled model directory -> load fully offline.
MODEL_DIR = sys.argv[4] if len(sys.argv) > 4 else None
if MODEL_DIR:
    os.environ["HF_HUB_OFFLINE"] = "1"
    MODEL = "nemo-parakeet-tdt-0.6b-v2"

CHUNK = 125.0          # seconds per inference window
STEP = 123.0           # advance (2s overlap, de-duplicated)
SR = 16000
MAX_CUE_CHARS = 84
MAX_CUE_DUR = 6.0
MAX_GAP = 0.7


def read_wav(path):
    with wave.open(path, "rb") as wf:
        n = wf.getnframes()
        raw = wf.readframes(n)
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def words_from_tokens(tokens, stamps, offset, skip_before):
    words, cur = [], None
    for tok, ts in zip(tokens, stamps):
        t = float(ts)
        if t < skip_before:
            continue
        if tok.startswith(" ") or cur is None:
            if cur:
                words.append(cur)
            cur = {"text": tok.strip(), "start": t + offset, "end": t + offset}
        else:
            cur["text"] += tok
            cur["end"] = t + offset
    if cur:
        words.append(cur)
    return [w for w in words if w["text"]]


def build_cues(words):
    # tighten word end times to the next word's start
    for i in range(len(words) - 1):
        words[i]["end"] = max(words[i]["end"], min(words[i + 1]["start"], words[i]["end"] + 0.6))
    cues, cur = [], []
    for w in words:
        if cur:
            text = " ".join(x["text"] for x in cur)
            prev = cur[-1]
            too_long = len(text) + len(w["text"]) > MAX_CUE_CHARS
            too_dur = w["end"] - cur[0]["start"] > MAX_CUE_DUR
            gap = w["start"] - prev["end"]
            sentence_end = prev["text"].endswith((".", "?", "!"))
            if too_long or too_dur or gap > MAX_GAP or sentence_end:
                cues.append(cur)
                cur = []
        cur.append(w)
    if cur:
        cues.append(cur)
    out = []
    for c in cues:
        text = " ".join(w["text"] for w in c).strip()
        if text:
            out.append({"start": round(c[0]["start"], 3),
                        "end": round(max(c[-1]["end"], c[0]["start"] + 0.8), 3),
                        "text": text})
    return out


def session_options():
    so = ort.SessionOptions()
    so.intra_op_num_threads = 0   # 0 = use all physical CPU cores
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    so.add_session_config_entry("session.intra_op.allow_spinning", "1")
    return so


def main():
    print("STAGE loading", flush=True)
    kwargs = dict(quantization="int8", providers=["CPUExecutionProvider"],
                  sess_options=session_options())
    if MODEL_DIR:
        kwargs["path"] = MODEL_DIR
    model = onnx_asr.load_model(MODEL, **kwargs).with_timestamps()
    audio = read_wav(AUDIO)
    total = max(len(audio) / SR, 0.1)
    state = OUT_JSON + ".state"
    words, start = [], 0.0
    if os.path.exists(state):                 # resume from where we stopped
        with open(state, encoding="utf-8") as f:
            d = json.load(f)
        words, start = d.get("words", []), float(d.get("next_start", 0.0))
    print("STAGE transcribing", flush=True)
    while start < total:
        seg = audio[int(start * SR):int((start + CHUNK) * SR)]
        if len(seg) < SR // 2:
            break
        r = model.recognize(seg, sample_rate=SR)
        words.extend(words_from_tokens(r.tokens, r.timestamps, start, 2.0 if start > 0 else 0.0))
        start += STEP
        with open(state, "w", encoding="utf-8") as f:
            json.dump({"words": words, "next_start": start}, f, ensure_ascii=False)
        print(f"PROG {min(99, int(start / total * 100))}", flush=True)
    cues = build_cues(words)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(cues, f, ensure_ascii=False)
    try:
        os.remove(state)
    except OSError:
        pass
    print(f"DONE {len(cues)}", flush=True)


if __name__ == "__main__":
    main()
