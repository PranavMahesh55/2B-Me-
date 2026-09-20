import { useState } from "react";
import { Play, X, GithubLogo, Monitor } from "@phosphor-icons/react";

/**
 * Shown only in the hosted browser build (VITE_HOSTED_PREVIEW=1), never in the
 * desktop app and never in local `npm run dev`.
 *
 * A hosted page cannot reach this Mac's Secure Enclave, the local broker or the
 * collector, so the three things that make 2Bᵐᵉ what it is are exactly the three
 * things a judge cannot click. Saying so up front is better than letting them
 * find out at the consent card -- and the film is right there, so the wall leads
 * somewhere instead of stopping them.
 */
export function PreviewBanner({ videoSrc = "brag.mp4", repoUrl }) {
  const [dismissed, setDismissed] = useState(false);
  const [filmOpen, setFilmOpen] = useState(false);

  if (dismissed && !filmOpen) {
    return (
      <button className="preview-reopen" type="button" onClick={() => setDismissed(false)}>
        <Monitor weight="fill" /> Browser preview
      </button>
    );
  }

  return (
    <>
      {!dismissed && (
        <aside className="preview-banner" aria-label="Browser preview notice">
          <div className="preview-banner-copy">
            <span className="preview-eyebrow">Browser preview</span>
            <p>
              The overlay and dashboard are the real interface. Behavioural numbers here are
              illustrative, because the collector, the local scoring service and the Secure
              Enclave signer all run on your own Mac — so authorizing an action will tell you
              it needs the desktop app. That refusal is the product.
            </p>
          </div>
          <div className="preview-banner-actions">
            <button className="preview-primary" type="button" onClick={() => setFilmOpen(true)}>
              <Play weight="fill" /> Watch the 30-second film
            </button>
            {repoUrl && (
              <a className="preview-secondary" href={repoUrl} target="_blank" rel="noreferrer">
                <GithubLogo weight="fill" /> Source
              </a>
            )}
          </div>
          <button
            className="preview-dismiss"
            type="button"
            aria-label="Dismiss preview notice"
            onClick={() => setDismissed(true)}
          >
            <X weight="bold" />
          </button>
        </aside>
      )}

      {filmOpen && (
        <div className="preview-film" role="dialog" aria-label="2B me launch film">
          <div className="preview-film-backdrop" onClick={() => setFilmOpen(false)} />
          <div className="preview-film-frame">
            <button
              className="preview-film-close"
              type="button"
              aria-label="Close film"
              onClick={() => setFilmOpen(false)}
            >
              <X weight="bold" />
            </button>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video src={videoSrc} poster="brag.jpg" controls autoPlay playsInline />
          </div>
        </div>
      )}
    </>
  );
}
