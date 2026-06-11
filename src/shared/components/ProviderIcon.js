"use client";

import { useEffect, useState } from "react";
import PropTypes from "prop-types";

export default function ProviderIcon({
  src,
  alt,
  size = 32,
  className = "",
  fallbackText = "?",
  fallbackColor,
}) {
  const [errored, setErrored] = useState(false);
  const [imageSrc, setImageSrc] = useState(src);

  useEffect(() => {
    setErrored(false);
    setImageSrc(src);
  }, [src]);

  if (!imageSrc || errored) {
    return (
      <span
        className={`inline-flex items-center justify-center font-bold rounded-lg ${className}`.trim()}
        style={{
          width: size,
          height: size,
          color: fallbackColor,
          fontSize: Math.max(10, Math.floor(size * 0.38)),
        }}
      >
        {fallbackText}
      </span>
    );
  }

  return (
    <img
      src={imageSrc}
      alt={alt}
      width={size}
      height={size}
      className={className}
      onError={() => {
        if (typeof imageSrc === "string" && imageSrc.endsWith(".png")) {
          setImageSrc(`${imageSrc.slice(0, -4)}.svg`);
          return;
        }
        setErrored(true);
      }}
    />
  );
}

ProviderIcon.propTypes = {
  src: PropTypes.string,
  alt: PropTypes.string,
  size: PropTypes.number,
  className: PropTypes.string,
  fallbackText: PropTypes.string,
  fallbackColor: PropTypes.string,
};
