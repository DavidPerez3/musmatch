import type { Metadata } from "next";
export const metadata: Metadata = {title:"Amigos y jugadores", description:"Amigos y jugadores en MusMatch. Accede con tu cuenta para utilizar esta sección.", robots:{index:false,follow:false}};
export default function Layout({children}: {children:React.ReactNode}) { return children; }
