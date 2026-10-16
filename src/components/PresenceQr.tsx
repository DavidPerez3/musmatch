"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { presenceQrPayload } from "@/lib/presenceQr";

export default function PresenceQr({
  eventId,
  token,
}: {
  eventId: string;
  token: string;
}) {
  const payload = presenceQrPayload(eventId, token);
  const [image, setImage] = useState<{ payload: string; url: string } | null>(
    null,
  );
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    import("qrcode")
      .then((qr) =>
        qr.toDataURL(payload, {
          width: 256,
          margin: 4,
          errorCorrectionLevel: "M",
        }),
      )
      .then((url) => {
        if (!cancelled) setImage({ payload, url });
      })
      .catch(() => {
        if (!cancelled) setFailed(payload);
      });
    return () => {
      cancelled = true;
    };
  }, [payload]);
  return (
    <div className="my-3">
      {image?.payload === payload ? (
        <Image
          src={image.url}
          alt="Mi QR de presencia: muéstralo a un rival"
          width={256}
          height={256}
          unoptimized
          className="mx-auto h-auto w-full max-w-64 rounded-xl bg-white"
        />
      ) : (
        <p role="status" className="text-sm text-white/70">
          {failed === payload
            ? "No hemos podido dibujar el QR. Utiliza el código manual."
            : "Preparando QR…"}
        </p>
      )}
    </div>
  );
}
