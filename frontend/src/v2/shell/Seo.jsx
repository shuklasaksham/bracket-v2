import React from "react";
import { Helmet } from "react-helmet-async";

export function Seo({ title, description, noindex = true }) {
  const t = title ? `${title} · Bracket` : "Bracket — A memory for your business";
  return (
    <Helmet>
      <title>{t}</title>
      {description && <meta name="description" content={description} />}
      {noindex && <meta name="robots" content="noindex" />}
    </Helmet>
  );
}
