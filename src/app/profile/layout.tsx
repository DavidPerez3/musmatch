import type { Metadata } from "next";
export const metadata: Metadata = {title:"Mi perfil", description:"Mi perfil en MusMatch. Accede con tu cuenta para utilizar esta sección.", robots:{index:false,follow:false}};
export default function Layout({children}: {children:React.ReactNode}) { return children; }
