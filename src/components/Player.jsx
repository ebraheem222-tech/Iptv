import React, { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import {
  Captions,
  FastForward,
  Maximize,
  Minimize,
  Pause,
  Play,
  Rewind,
  RotateCcw,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { api, apiText, asset, save, saved } from "../lib/api";
import {
  cueAt,
  normalizeCaptionTracks,
  parseWebVtt,
} from "../lib/captions";
import { useModalFocus } from "../lib/remote";
import "./Player.css";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const time = (n) => {
  n = Math.max(0, Math.floor(n || 0));
  return (
    (n >= 3600 ? Math.floor(n / 3600) + ":" : "") +
    String(Math.floor(n / 60) % 60).padStart(2, "0") +
    ":" +
    String(n % 60).padStart(2, "0")
  );
};
const initialVolume = () => {
  const value = Number(saved("nova.volume", "1"));
  return Number.isFinite(value) ? clamp(value, 0, 1) : 1;
};

export default function Player({ item, progress, onProgress, close }) {
  const modal = useRef(null),
    video = useRef(null),
    adapter = useRef(null),
    positionRef = useRef(0),
    durationRef = useRef(0),
    liveRef = useRef(false),
    volumeRef = useRef(initialVolume()),
    mutedRef = useRef(saved("nova.muted") === "1"),
    captionIndexRef = useRef(-1),
    captionCuesRef = useRef([]);
  useModalFocus(modal);

  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [paused, setPaused] = useState(false),
    [position, setPosition] = useState(0),
    [duration, setDuration] = useState(0),
    [live, setLive] = useState(false),
    [attempt, setAttempt] = useState(0),
    [volume, setVolume] = useState(volumeRef.current),
    [muted, setMuted] = useState(mutedRef.current),
    [captionTracks, setCaptionTracks] = useState([]),
    [captionIndex, setCaptionIndex] = useState(-1),
    [captionText, setCaptionText] = useState(""),
    [captionLoading, setCaptionLoading] = useState(false),
    [captionMenuOpen, setCaptionMenuOpen] = useState(false),
    [fullscreen, setFullscreen] = useState(false),
    [recovery, setRecovery] = useState("");

  const rememberVolume = (value) => {
    const next = clamp(Number(value) || 0, 0, 1);
    volumeRef.current = next;
    setVolume(next);
    save("nova.volume", String(next));
  };
  const rememberMuted = (value) => {
    const next = Boolean(value);
    mutedRef.current = next;
    setMuted(next);
    save("nova.muted", next ? "1" : "");
  };
  const rememberCaption = (value) => {
    captionIndexRef.current = value;
    setCaptionIndex(value);
  };

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
    const syncFullscreen = () =>
      setFullscreen(
        Boolean(document.fullscreenElement || document.webkitFullscreenElement),
      );
    document.addEventListener("fullscreenchange", syncFullscreen);
    document.addEventListener("webkitfullscreenchange", syncFullscreen);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreen);
      document.removeEventListener("webkitfullscreenchange", syncFullscreen);
    };
  }, []);

  useEffect(() => {
    let disposed = false,
      hls = null,
      av = null,
      interval = null,
      hlsRecoveryTimer = null,
      hlsStableTimer = null,
      nativeRetryTimer = null,
      nativeStableTimer = null,
      hlsNetworkFailures = 0,
      hlsMediaFailures = 0,
      hlsParsingFailures = 0,
      lastLiveProgressAt = Date.now(),
      lastLivePosition = -1,
      nativeFailures = 0,
      avTextTracks = [],
      availableCaptionTracks = [];
    const captionAbort = new AbortController();

    setLoading(true);
    setError("");
    setRecovery("");
    setCaptionTracks([]);
    setCaptionText("");
    setCaptionLoading(false);
    setCaptionMenuOpen(false);
    captionCuesRef.current = [];
    rememberCaption(-1);

    const fail = (message) => {
      if (!disposed) {
        setLoading(false);
        setRecovery("");
        setError(message);
      }
    };
    const update = (p, d) => {
      positionRef.current = p;
      durationRef.current = d;
      if (captionCuesRef.current.length && !disposed)
        setCaptionText(cueAt(captionCuesRef.current, p));
      if (!disposed) {
        setPosition(p);
        setDuration(d);
      }
    };
    const markRecovered = () => {
      if (disposed) return;
      setRecovery("");
      setLoading(false);
    };
    const scheduleStableHlsReset = () => {
      clearTimeout(hlsStableTimer);
      hlsStableTimer = setTimeout(() => {
        hlsNetworkFailures = 0;
        hlsMediaFailures = 0;
      }, 12000);
    };

    const disableCaptions = () => {
      captionCuesRef.current = [];
      setCaptionText("");
      try {
        av?.setSilentSubtitle?.(true);
      } catch {}
      if (hls) hls.subtitleTrack = -1;
      Array.from(video.current?.textTracks || []).forEach((track) => {
        track.mode = "disabled";
      });
      rememberCaption(-1);
    };

    const selectCaption = async (index) => {
      if (index < 0) return disableCaptions();
      const track = availableCaptionTracks[index];
      if (!track) return;
      captionCuesRef.current = [];
      setCaptionText("");
      try {
        if (track.source === "server") {
          const text = await apiText(track.url, captionAbort.signal);
          if (disposed) return;
          captionCuesRef.current = parseWebVtt(text);
          setCaptionText(cueAt(captionCuesRef.current, positionRef.current));
        } else if (track.source === "avplay") {
          av.setSelectTrack?.("TEXT", Number(track.sourceId));
          av.setSilentSubtitle?.(false);
        } else if (track.source === "hls") {
          hls.subtitleTrack = Number(track.sourceId);
        } else if (track.source === "native") {
          const tracks = Array.from(video.current?.textTracks || []);
          tracks.forEach((row, rowIndex) => {
            row.mode = rowIndex === Number(track.sourceId) ? "showing" : "disabled";
          });
        }
        rememberCaption(index);
      } catch (captionError) {
        if (!disposed && captionError.message !== "Request cancelled.") {
          console.warn("NOVA captions unavailable", captionError.message);
          disableCaptions();
        }
      }
    };

    const useCaptionTracks = (rows) => {
      const normalized = normalizeCaptionTracks(rows);
      availableCaptionTracks = normalized.tracks;
      setCaptionTracks(normalized.tracks);
      if (normalized.preferredId) {
        const index = normalized.tracks.findIndex(
          (track) => track.id === normalized.preferredId,
        );
        if (index >= 0) selectCaption(index);
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

        if (!data.live && data.captionsUrl) {
          setCaptionLoading(true);
          api(data.captionsUrl, "GET", undefined, captionAbort.signal)
            .then(({ tracks = [] }) => {
              if (disposed || !tracks.length) return;
              useCaptionTracks(
                tracks.map((track) => ({
                  ...track,
                  source: "server",
                  sourceId: track.id,
                  url: `${data.captionsUrl}/${encodeURIComponent(track.id)}.vtt`,
                })),
              );
            })
            .catch((captionError) => {
              if (
                !disposed &&
                captionError.message !== "Request cancelled."
              )
                console.warn("NOVA captions could not be checked");
            })
            .finally(() => {
              if (!disposed) setCaptionLoading(false);
            });
        }

        if (av) {
          try {
            av.open(url);
            av.setDisplayRect(0, 0, 1920, 1080);
            av.setDisplayMethod("PLAYER_DISPLAY_MODE_LETTER_BOX");
            av.setListener({
              onbufferingstart: () => {
                setLoading(true);
                setRecovery("Buffering…");
              },
              onbufferingcomplete: markRecovered,
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
                try {
                  avTextTracks = (av.getTotalTrackInfo?.() || []).filter(
                    (track) => track.type === "TEXT",
                  );
                  av.setSilentSubtitle?.(true);
                  if (avTextTracks.length)
                    useCaptionTracks(
                      avTextTracks.map((track, index) => {
                        let extra = {};
                        try {
                          extra = JSON.parse(track.extra_info || "{}");
                        } catch {}
                        const sourceId = track.index ?? index;
                        return {
                          id: `avplay:${sourceId}`,
                          source: "avplay",
                          sourceId,
                          language:
                            extra.track_lang ||
                            extra.language ||
                            track.language ||
                            "",
                          title:
                            extra.title ||
                            extra.track_name ||
                            track.label ||
                            "",
                          label: `Subtitle ${index + 1}`,
                        };
                      }),
                    );
                } catch {}
                try {
                  const tvVolume = window.tizen?.tvaudiocontrol?.getVolume?.();
                  if (Number.isFinite(tvVolume)) rememberVolume(tvVolume / 100);
                  const tvMuted = window.tizen?.tvaudiocontrol?.isMute?.();
                  if (typeof tvMuted === "boolean") rememberMuted(tvMuted);
                } catch {}
                av.play();
                setLoading(false);
                setRecovery("");
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
              seekTo: (seconds) => {
                if (!data.live)
                  av.seekTo(
                    Math.round(
                      clamp(seconds * 1000, 0, Math.max(0, av.getDuration())),
                    ),
                  );
              },
              volume: (value) => {
                rememberVolume(value);
                try {
                  window.tizen?.tvaudiocontrol?.setVolume?.(
                    Math.round(volumeRef.current * 100),
                  );
                } catch {}
              },
              mute: () => {
                const next = !mutedRef.current;
                rememberMuted(next);
                try {
                  window.tizen?.tvaudiocontrol?.setMute?.(next);
                } catch {}
              },
              captions: () => {
                const next =
                  captionIndexRef.current >= availableCaptionTracks.length - 1
                    ? -1
                    : captionIndexRef.current + 1;
                selectCaption(next);
              },
              selectCaption,
            };
            window.webapis?.appcommon?.setScreenSaver(0);
          } catch (e) {
            fail("Samsung player could not start: " + e.message);
          }
          return;
        }

        const v = video.current;
        v.volume = volumeRef.current;
        v.muted = mutedRef.current;

        const syncNativeTracks = () => {
          const tracks = Array.from(v.textTracks || []);
          if (tracks.length)
            useCaptionTracks(
              tracks.map((track, index) => ({
                id: `native:${index}`,
                source: "native",
                sourceId: index,
                language: track.language || "",
                label:
                  track.label || track.language || `Subtitle ${index + 1}`,
              })),
            );
        };
        const start = () => {
          setLoading(false);
          setRecovery("");
          if (
            !data.live &&
            progress?.position &&
            v.duration > progress.position
          )
            v.currentTime = progress.position;
          syncNativeTracks();
          v.play().catch(() => {
            setPaused(true);
            setLoading(false);
          });
        };
        const nativeFailure = () => {
          const mediaError = v.error;
          if (data.live && nativeFailures < 3) {
            nativeFailures += 1;
            setError("");
            setLoading(true);
            setRecovery(`Reconnecting live stream… (${nativeFailures}/3)`);
            clearTimeout(nativeRetryTimer);
            nativeRetryTimer = setTimeout(() => {
              if (disposed) return;
              v.src = url;
              v.load();
            }, 700 * 2 ** (nativeFailures - 1));
            return;
          }
          const details = mediaError?.message
            ? ` (${mediaError.message})`
            : mediaError?.code
              ? ` (media error ${mediaError.code})`
              : "";
          fail(
            "This stream could not be played" +
              details +
              ". The provider may be offline, or this device may not support its codec.",
          );
        };

        v.onloadedmetadata = start;
        v.onplaying = () => {
          setLoading(false);
          setRecovery("");
          setPaused(false);
          clearTimeout(nativeStableTimer);
          nativeStableTimer = setTimeout(() => {
            nativeFailures = 0;
          }, 15000);
        };
        v.onpause = () => setPaused(true);
        v.onwaiting = () => {
          setLoading(true);
          if (data.live) setRecovery("Buffering live stream…");
        };
        v.oncanplay = markRecovered;
        v.ontimeupdate = () => {
          if (data.live && v.currentTime > lastLivePosition + 0.05) {
            lastLivePosition = v.currentTime;
            lastLiveProgressAt = Date.now();
          }
          update(v.currentTime, Number.isFinite(v.duration) ? v.duration : 0);
        };
        v.onvolumechange = () => {
          rememberVolume(v.volume);
          rememberMuted(v.muted);
        };
        v.onended = () => {
          setPaused(true);
          persist();
        };
        v.onerror = () => {
          if (!hls) nativeFailure();
        };

        const isHls = /mpegurl|m3u8/i.test(data.mime + " " + url);
        const isWebOS =
          /web[o0]s|netcast/i.test(navigator.userAgent) || !!window.PalmSystem;

        if (isHls && !isWebOS && Hls.isSupported()) {
          hls = new Hls({
            // IPTV providers often expose classic HLS while incorrectly advertising
            // low-latency/delta-playlist features. Prefer conservative playlist
            // reloads for compatibility and stability.
            lowLatencyMode: false,
            backBufferLength: 30,
            maxBufferLength: 30,
            liveSyncDurationCount: 3,
            liveMaxLatencyDurationCount: 10,
            nudgeMaxRetry: 6,
          });
          hls.attachMedia(v);
          hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(url));
          hls.on(Hls.Events.FRAG_LOADED, () => {
            scheduleStableHlsReset();
            if (!disposed) setRecovery("");
          });
          hls.on(Hls.Events.LEVEL_LOADED, () => {
            hlsParsingFailures = 0;
            if (!disposed) {
              setRecovery("");
              setLoading(false);
            }
          });
          hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_, event) => {
            const tracks = event.subtitleTracks || hls.subtitleTracks || [];
            if (tracks.length)
              useCaptionTracks(
                tracks.map((track, index) => ({
                  id: `hls:${index}`,
                  source: "hls",
                  sourceId: index,
                  language: track.lang || track.language || "",
                  label:
                    track.name ||
                    track.lang ||
                    track.language ||
                    `Subtitle ${index + 1}`,
                  default: track.default,
                  forced: track.forced,
                })),
              );
          });
          hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_, event) => {
            const index = availableCaptionTracks.findIndex(
              (track) =>
                track.source === "hls" && track.sourceId === event.id,
            );
            rememberCaption(index);
          });
          hls.on(Hls.Events.ERROR, (_, event) => {
            if (disposed) return;

            const diagnostic = {
              type: event.type,
              details: event.details,
              fatal: event.fatal,
              reason: event.reason || event.error?.message || "",
              url: event.url || event.context?.url || "",
            };
            if (event.fatal) console.error("NOVA HLS fatal error", diagnostic);
            else console.warn("NOVA HLS warning", diagnostic);

            if (!event.fatal) return;

            const isLevelParsingError =
              event.details === Hls.ErrorDetails.LEVEL_PARSING_ERROR ||
              event.details === "levelParsingError";

            // A live IPTV playlist can occasionally return one malformed refresh
            // while already-buffered video continues playing. Do not cover working
            // video with a fatal dialog. Reload the playlist source and only give
            // up when playback itself has stopped advancing for a sustained period.
            if (data.live && isLevelParsingError) {
              hlsParsingFailures += 1;
              const stalledFor = Date.now() - lastLiveProgressAt;
              setError("");

              if (stalledFor > 3000) {
                setLoading(true);
                setRecovery("Refreshing live playlist…");
              } else {
                setLoading(false);
                setRecovery("");
              }

              if (stalledFor < 12000 || hlsParsingFailures <= 8) {
                clearTimeout(hlsRecoveryTimer);
                hlsRecoveryTimer = setTimeout(() => {
                  if (disposed) return;
                  try {
                    hls.stopLoad();
                    hls.loadSource(url);
                  } catch (reloadError) {
                    console.error("NOVA HLS playlist reload failed", reloadError);
                  }
                }, Math.min(2000, 350 * hlsParsingFailures));
                return;
              }

              const reason = diagnostic.reason
                ? `: ${diagnostic.reason}`
                : "";
              fail(
                "The live playlist remained invalid for too long" +
                  reason +
                  ". Try another channel or check the provider stream.",
              );
              return;
            }

            if (
              event.type === Hls.ErrorTypes.NETWORK_ERROR &&
              hlsNetworkFailures < 4
            ) {
              hlsNetworkFailures += 1;
              setError("");
              setLoading(true);
              setRecovery(`Reconnecting live stream… (${hlsNetworkFailures}/4)`);
              clearTimeout(hlsRecoveryTimer);
              hlsRecoveryTimer = setTimeout(
                () => {
                  if (!disposed) hls.startLoad();
                },
                500 * 2 ** (hlsNetworkFailures - 1),
              );
              return;
            }
            if (
              event.type === Hls.ErrorTypes.MEDIA_ERROR &&
              hlsMediaFailures < 3
            ) {
              hlsMediaFailures += 1;
              setError("");
              setLoading(true);
              setRecovery(`Recovering stream codec… (${hlsMediaFailures}/3)`);
              try {
                if (hlsMediaFailures === 2) hls.swapAudioCodec();
                hls.recoverMediaError();
                return;
              } catch {}
            }
            fail(
              "Stream playback failed (" +
                (event.details || event.type || "unknown HLS error") +
                (diagnostic.reason ? `: ${diagnostic.reason}` : "") +
                "). Automatic recovery was exhausted. Try again or choose another channel.",
            );
          });
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
          seek: (seconds) => {
            if (!data.live && Number.isFinite(v.duration))
              v.currentTime = clamp(v.currentTime + seconds, 0, v.duration);
          },
          seekTo: (seconds) => {
            if (!data.live && Number.isFinite(v.duration))
              v.currentTime = clamp(seconds, 0, v.duration);
          },
          volume: (value) => {
            const next = clamp(Number(value) || 0, 0, 1);
            v.volume = next;
            if (next > 0 && v.muted) v.muted = false;
            rememberVolume(next);
            rememberMuted(v.muted);
          },
          mute: () => {
            v.muted = !v.muted;
            rememberMuted(v.muted);
          },
          captions: () => {
            const next =
              captionIndexRef.current >= availableCaptionTracks.length - 1
                ? -1
                : captionIndexRef.current + 1;
            selectCaption(next);
          },
          selectCaption,
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
            } else if (!wantsPlay && av.getState() === "PLAYING") {
              av.pause();
              setPaused(true);
              try {
                window.webapis?.appcommon?.setScreenSaver(1);
              } catch {}
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
      ].forEach((key) => window.tizen?.tvinputdevice?.registerKey(key));
    } catch {}

    return () => {
      disposed = true;
      captionAbort.abort();
      captionCuesRef.current = [];
      persist();
      clearInterval(interval);
      clearTimeout(hlsRecoveryTimer);
      clearTimeout(hlsStableTimer);
      clearTimeout(nativeRetryTimer);
      clearTimeout(nativeStableTimer);
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
        video.current.onloadedmetadata = null;
        video.current.onplaying = null;
        video.current.onpause = null;
        video.current.onwaiting = null;
        video.current.oncanplay = null;
        video.current.ontimeupdate = null;
        video.current.onvolumechange = null;
        video.current.onended = null;
        video.current.onerror = null;
        video.current.pause();
        video.current.removeAttribute("src");
        video.current.load();
      }
      adapter.current = null;
    };
  }, [item.id, attempt]);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        await exit?.call(document);
      } else {
        const request =
          modal.current?.requestFullscreen || modal.current?.webkitRequestFullscreen;
        await request?.call(modal.current);
      }
    } catch {}
  };

  const selectedCaption =
    captionIndex >= 0 ? captionTracks[captionIndex] : null;
  const captionLabel =
    captionIndex >= 0
      ? `Captions: ${captionTracks[captionIndex]?.label || "On"}`
      : captionLoading
        ? "Checking captions"
      : captionTracks.length
        ? "Captions off"
        : "No captions";

  return (
    <div
      className="player"
      data-modal
      ref={modal}
      role="dialog"
      aria-modal="true"
      aria-label={"Playing " + item.name}
      onDoubleClick={toggleFullscreen}
    >
      {window.webapis?.avplay ? (
        <object className="native-player" type="application/avplayer" />
      ) : (
        <video ref={video} playsInline />
      )}
      {captionText && (
        <div
          className={
            "caption-overlay " +
            (selectedCaption?.language === "ar" ? "arabic" : "")
          }
          data-testid="caption-overlay"
          dir={selectedCaption?.language === "ar" ? "rtl" : "auto"}
        >
          {captionText}
        </div>
      )}
      <div className="player-top">
        <div>
          <span className="eyebrow accent">
            {live ? "LIVE NOW" : "NOW PLAYING"}
          </span>
          <h2>{item.name}</h2>
          {recovery && !error && <small className="player-recovery">{recovery}</small>}
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
        <div className="player-message player-loading">
          <span className="spinner" />
          <p>{recovery || "Getting your stream ready…"}</p>
        </div>
      )}
      {error && (
        <div className="player-message" role="alert">
          <h2>Let’s try that again.</h2>
          <p>{error}</p>
          <button
            className="primary"
            onClick={() => setAttempt((value) => value + 1)}
          >
            <RotateCcw size={18} />
            Retry playback
          </button>
        </div>
      )}

      <div className="player-controls">
        {!live ? (
          <div className="timeline">
            <span>{time(position)}</span>
            <input
              aria-label="Seek"
              type="range"
              min="0"
              max={Math.max(duration, 1)}
              step="1"
              value={Math.min(position, Math.max(duration, 1))}
              onChange={(e) => {
                const next = Number(e.target.value);
                updatePositionLocally(next, setPosition, positionRef);
                adapter.current?.seekTo(next);
              }}
            />
            <span>{duration ? time(duration) : "--:--"}</span>
          </div>
        ) : (
          <div className="live-line">
            <span className="live-dot" />
            LIVE · duration is controlled by the channel
          </div>
        )}

        <div className="player-control-row">
          <div className="playback-buttons">
            <button
              className="secondary compact-control"
              disabled={live}
              aria-label="Rewind 10 seconds"
              onClick={() => adapter.current?.seek(-10)}
            >
              <Rewind />
              <span>10s</span>
            </button>
            <button
              className="primary compact-control main-play"
              aria-label={paused ? "Play" : "Pause"}
              onClick={() => adapter.current?.toggle()}
            >
              {paused ? <Play /> : <Pause />}
              <span>{paused ? "Play" : "Pause"}</span>
            </button>
            <button
              className="secondary compact-control"
              disabled={live}
              aria-label="Forward 10 seconds"
              onClick={() => adapter.current?.seek(10)}
            >
              <span>10s</span>
              <FastForward />
            </button>
          </div>

          <div className="player-tools">
            <button
              className="tool-button"
              aria-label={muted ? "Unmute" : "Mute"}
              title={muted ? "Unmute" : "Mute"}
              onClick={() => adapter.current?.mute()}
            >
              {muted || volume === 0 ? <VolumeX /> : <Volume2 />}
            </button>
            <div className="volume-control">
              <input
                aria-label="Volume"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={muted ? 0 : volume}
                onChange={(e) => adapter.current?.volume(e.target.value)}
              />
              <span>{muted ? 0 : Math.round(volume * 100)}%</span>
            </div>
            <button
              type="button"
              className={"tool-button " + (captionIndex >= 0 ? "active" : "")}
              aria-label={captionLabel}
              title={captionLabel}
              disabled={!captionTracks.length && !captionLoading}
              onClick={() => setCaptionMenuOpen((open) => !open)}
            >
              <Captions />
              <span>CC</span>
            </button>
            {captionMenuOpen && (
              <div className="caption-menu" role="menu" aria-label="Captions">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={captionIndex < 0}
                  onClick={() => {
                    adapter.current?.selectCaption(-1);
                    setCaptionMenuOpen(false);
                  }}
                >
                  Off
                </button>
                {captionTracks.map((track, index) => (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={captionIndex === index}
                    key={track.id}
                    onClick={() => {
                      adapter.current?.selectCaption(index);
                      setCaptionMenuOpen(false);
                    }}
                  >
                    {track.label}
                  </button>
                ))}
              </div>
            )}
            <button
              className="tool-button"
              aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              onClick={toggleFullscreen}
            >
              {fullscreen ? <Minimize /> : <Maximize />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function updatePositionLocally(value, setPosition, positionRef) {
  positionRef.current = value;
  setPosition(value);
}
