import type { Metadata } from "next";
export const metadata: Metadata = {title:"Partida de mus", description:"Partida de mus en MusMatch. Accede con tu cuenta para utilizar esta sección.", robots:{index:false,follow:false}};
export default function Layout({children}: {children:React.ReactNode}) { return children; }
