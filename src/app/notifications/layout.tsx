import type { Metadata } from "next";
export const metadata: Metadata = {title:"Avisos y notificaciones", description:"Avisos y notificaciones en MusMatch. Accede con tu cuenta para utilizar esta sección.", robots:{index:false,follow:false}};
export default function Layout({children}: {children:React.ReactNode}) { return children; }
