import type { Metadata } from "next";
export const metadata: Metadata = {title:"Ranking", description:"Ranking en MusMatch. Accede con tu cuenta para utilizar esta sección.", robots:{index:false,follow:false}};
export default function Layout({children}: {children:React.ReactNode}) { return children; }
