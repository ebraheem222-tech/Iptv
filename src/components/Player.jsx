import React, { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { X, Play, Pause, RotateCcw, FastForward, Rewind } from "lucide-react";
import { api, asset } from "../lib/api";
import { useModalFocus } from "../lib/remote";
const time = (n) => {
  n = Math.max(0, Math.floor(n || 0));
  return (
    (n >= 3600 ? Math.floor(n / 3600) + ":" : "") +
    String(Math.floor(n / 60) % 60).padStart(2, "0") +
    ":" +
    String(n % 60).padStart(2, "0")
  );
};
export default function Player({ item, progress, onProgress, close }) {
  const modal = useRef(null),
    video = useRef(null),
    adapter = useRef(null),
    positionRef = useRef(0),
    durationRef = useRef(0),
    liveRef = useRef(false);
  useModalFocus(modal);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [paused, setPaused] = useState(false),
    [position, setPosition] = useState(0),
    [duration, setDuration] = useState(0),
    [live, setLive] = useState(false),
    [attempt, setAttempt] = useState(0);
  const persist = () => {
    if (liveRef.current || positionRef.current < 1 || !durationRef.current)
      return;
    api("/api/preferences/progress", "PUT", {
      item,
      position: positionRef.current,
      duration: durationRef.current,
    })
      .then(onProgress)
      .catch((e) => setError("Progress could not be saved: " + e.message));
  };
  useEffect(() => {
    let disposed = false,
      hls = null,
      av = null,
      interval = null;
    setLoading(true);
    setError("");
    const fail = (message) => {
      if (!disposed) {
        setLoading(false);
        setError(message);
      }
    };
    const update = (p, d) => {
      positionRef.current = p;
      durationRef.current = d;
      if (!disposed) {
        setPosition(p);
        setDuration(d);
      }
    };
    api("/api/play", "POST", {
      kind: item.kind,
      id: item.id,
      extension: item.extension,
    })
      .then((data) => {
        if (disposed) return;
        setLive(data.live);
        liveRef.current = data.live;
        const url = asset(data.url);
        av = window.webapis?.avplay;
        if (av) {
          try {
            av.open(url);
            av.setDisplayRect(0, 0, 1920, 1080);
            av.setDisplayMethod("PLAYER_DISPLAY_MODE_LETTER_BOX");
            av.setListener({
              onbufferingstart: () => setLoading(true),
              onbufferingcomplete: () => setLoading(false),
              oncurrentplaytime: (ms) =>
                update(ms / 1000, av.getDuration() / 1000),
              onstreamcompleted: () => {
                setPaused(true);
                persist();
              },
              onerror: (e) =>
                fail(
                  "TV playback failed (" +
                    e +
                    "). Check the stream format and try again.",
                ),
            });
            av.prepareAsync(
              () => {
                if (disposed) {
                  try {
                    av.close();
                  } catch {}
                  return;
                }
                const start = progress?.position || 0;
                if (!data.live && start > 0) av.seekTo(start * 1000);
                av.play();
                setLoading(false);
                setPaused(false);
              },
              (e) => fail("Unable to prepare this stream: " + e),
            );
            adapter.current = {
              toggle: () => {
                if (av.getState() === "PLAYING") {
                  av.pause();
                  setPaused(true);
                  try {
                    window.webapis?.appcommon?.setScreenSaver(1);
                  } catch {}
                } else {
                  av.play();
                  setPaused(false);
                  try {
                    window.webapis?.appcommon?.setScreenSaver(0);
                  } catch {}
                }
              },
              seek: (seconds) => {
                if (!data.live)
                  av.seekTo(
                    Math.max(
                      0,
                      Math.min(
                        av.getDuration(),
                        av.getCurrentTime() + seconds * 1000,
                      ),
                    ),
                  );
              },
            };
            window.webapis?.appcommon?.setScreenSaver(0);
          } catch (e) {
            fail("Samsung player could not start: " + e.message);
          }
          return;
        }
        const v = video.current;
        const start = () => {
          setLoading(false);
          if (
            !data.live &&
            progress?.position &&
            v.duration > progress.position
          )
            v.currentTime = progress.position;
          v.play().catch(() => {
            setPaused(true);
            setLoading(false);
          });
        };
        v.onloadedmetadata = start;
        v.onplaying = () => {
          setLoading(false);
          setPaused(false);
        };
        v.onpause = () => setPaused(true);
        v.onwaiting = () => setLoading(true);
        v.ontimeupdate = () =>
          update(v.currentTime, Number.isFinite(v.duration) ? v.duration : 0);
        v.onended = () => {
          setPaused(true);
          persist();
        };
        v.onerror = () =>
          fail(
            "This stream could not be played. The provider may be offline, or this device may not support its codec.",
          );
        const isHls = /mpegurl|m3u8/i.test(data.mime + " " + url);
        const isWebOS =
          /web[o0]s|netcast/i.test(navigator.userAgent) || !!window.PalmSystem;
        // TV-native HLS is intentional on webOS. Desktop Chrome can advertise
        // "maybe" yet reject playlists, so use the MSE adapter when available.
        if (isHls && !isWebOS && Hls.isSupported()) {
          if (Hls.isSupported()) {
            hls = new Hls();
            hls.loadSource(url);
            hls.attachMedia(v);
            hls.on(Hls.Events.ERROR, (_, e) => {
              if (e.fatal)
                fail(
                  "Stream playback failed (" +
                    e.details +
                    "). Try again or choose another title.",
                );
            });
          } else fail("This TV does not support this HLS stream.");
        } else if (
          isHls &&
          !isWebOS &&
          !v.canPlayType("application/vnd.apple.mpegurl")
        ) {
          fail("This device does not support this HLS stream.");
        } else {
          v.src = url;
          v.load();
        }
        adapter.current = {
          toggle: () => {
            if (v.paused) v.play().catch((e) => fail(e.message));
            else v.pause();
          },
          seek: (s) => {
            if (!data.live && Number.isFinite(v.duration))
              v.currentTime = Math.max(
                0,
                Math.min(v.duration, v.currentTime + s),
              );
          },
        };
      })
      .catch((e) => fail(e.message));
    interval = setInterval(persist, 15000);
    const media = (e) => {
      if (
        [415, 19, 10252, 412, 417, 413].indexOf(e.keyCode) < 0 &&
        e.code !== "Space"
      )
        return;
      if (e.target.tagName === "BUTTON" && e.code === "Space") return;
      e.preventDefault();
      if (e.keyCode === 413) {
        close();
        return;
      }
      if (e.keyCode === 415 || e.keyCode === 19) {
        const wantsPlay = e.keyCode === 415;
        try {
          if (av) {
            if (wantsPlay && av.getState() === "PAUSED") {
              av.play();
              setPaused(false);
              try {
                window.webapis?.appcommon?.setScreenSaver(0);
              } catch {}
              window.webapis?.appcommon?.setScreenSaver(0);
            } else if (!wantsPlay && av.getState() === "PLAYING") {
              av.pause();
              setPaused(true);
              try {
                window.webapis?.appcommon?.setScreenSaver(1);
              } catch {}
              window.webapis?.appcommon?.setScreenSaver(1);
            }
          } else if (video.current) {
            if (wantsPlay) video.current.play().catch((e) => fail(e.message));
            else video.current.pause();
          }
        } catch (e) {
          fail(e.message);
        }
        return;
      }
      if (e.keyCode === 412) adapter.current?.seek(-10);
      else if (e.keyCode === 417) adapter.current?.seek(10);
      else adapter.current?.toggle();
    };
    const visibility = () => {
      if (document.hidden) {
        try {
          if (av?.getState() === "PLAYING") av.pause();
          else if (video.current) video.current.pause();
          setPaused(true);
          try {
            window.webapis?.appcommon?.setScreenSaver(1);
          } catch {}
          persist();
        } catch {}
      }
    };
    document.addEventListener("keydown", media);
    document.addEventListener("visibilitychange", visibility);
    try {
      [
        "MediaPlay",
        "MediaPause",
        "MediaPlayPause",
        "MediaRewind",
        "MediaFastForward",
        "MediaStop",
      ].forEach((k) => window.tizen?.tvinputdevice?.registerKey(k));
    } catch {}
    return () => {
      disposed = true;
      persist();
      clearInterval(interval);
      document.removeEventListener("keydown", media);
      document.removeEventListener("visibilitychange", visibility);
      hls?.destroy();
      if (av) {
        try {
          av.stop();
        } catch {}
        try {
          av.close();
        } catch {}
        try {
          window.webapis?.appcommon?.setScreenSaver(1);
        } catch {}
      }
      if (video.current) {
        video.current.pause();
        video.current.removeAttribute("src");
        video.current.load();
      }
      adapter.current = null;
    };
  }, [item.id, attempt]);
  return (
    <div
      className="player"
      data-modal
      ref={modal}
      role="dialog"
      aria-modal="true"
      aria-label={"Playing " + item.name}
    >
      {window.webapis?.avplay ? (
        <object className="native-player" type="application/avplayer" />
      ) : (
        <video ref={video} playsInline />
      )}
      <div className="player-top">
        <div>
          <span className="eyebrow accent">
            {live ? "LIVE NOW" : "NOW PLAYING"}
          </span>
          <h2>{item.name}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close player"
          onClick={close}
        >
          <X />
        </button>
      </div>
      {loading && !error && (
        <div className="player-message">
          <span className="spinner" />
          <p>Getting your stream ready…</p>
        </div>
      )}
      {error && (
        <div className="player-message" role="alert">
          <h2>Let’s try that again.</h2>
          <p>{error}</p>
          <button className="primary" onClick={() => setAttempt(attempt + 1)}>
            <RotateCcw size={18} />
            Retry playback
          </button>
        </div>
      )}
      <div className="player-controls">
        {!live && (
          <div className="timeline">
            <span>{time(position)}</span>
            <div>
              <i
                style={{
                  width: (duration ? (position / duration) * 100 : 0) + "%",
                }}
              />
            </div>
            <span>{time(duration)}</span>
          </div>
        )}
        <div className="playback-buttons">
          <button
            className="secondary"
            disabled={live}
            aria-label="Rewind 10 seconds"
            onClick={() => adapter.current?.seek(-10)}
          >
            <Rewind />
            10s
          </button>
          <button
            className="primary"
            aria-label={paused ? "Play" : "Pause"}
            onClick={() => adapter.current?.toggle()}
          >
            {paused ? <Play /> : <Pause />}
            {paused ? "Play" : "Pause"}
          </button>
          <button
            className="secondary"
            disabled={live}
            aria-label="Forward 10 seconds"
            onClick={() => adapter.current?.seek(10)}
          >
            10s
            <FastForward />
          </button>
          <span>
            {live ? "● LIVE" : "Use remote media keys to control playback"} ·
            Back to close
          </span>
        </div>
      </div>
    </div>
  );
}
