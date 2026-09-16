import avatar7661735044884463616 from "../../assets/dw-avatars/7661735044884463616.png?no-inline";
import avatar7661735044892852224 from "../../assets/dw-avatars/7661735044892852224.png?no-inline";
import avatar7661735044901240832 from "../../assets/dw-avatars/7661735044901240832.png?no-inline";
import avatar7661735044905435136 from "../../assets/dw-avatars/7661735044905435136.png?no-inline";
import avatar7661735044926406656 from "../../assets/dw-avatars/7661735044926406656.png?no-inline";
import avatar7661735044934795264 from "../../assets/dw-avatars/7661735044934795264.png?no-inline";
import avatar7661735048449622016 from "../../assets/dw-avatars/7661735048449622016.png?no-inline";
import avatar7661735051360468992 from "../../assets/dw-avatars/7661735051360468992.png?no-inline";
import avatar7661735051435966464 from "../../assets/dw-avatars/7661735051435966464.png?no-inline";
import avatar7661735051435982848 from "../../assets/dw-avatars/7661735051435982848.png?no-inline";
import avatar7661735051473715200 from "../../assets/dw-avatars/7661735051473715200.png?no-inline";
import avatar7661735051519852544 from "../../assets/dw-avatars/7661735051519852544.png?no-inline";
import avatar7661735054938210304 from "../../assets/dw-avatars/7661735054938210304.png?no-inline";
import avatar7661735057962303488 from "../../assets/dw-avatars/7661735057962303488.png?no-inline";
import avatar7661735057974886400 from "../../assets/dw-avatars/7661735057974886400.png?no-inline";
import avatar7661735058012635136 from "../../assets/dw-avatars/7661735058012635136.png?no-inline";
import avatar7661735058029412352 from "../../assets/dw-avatars/7661735058029412352.png?no-inline";
import avatar7661735058180407296 from "../../assets/dw-avatars/7661735058180407296.png?no-inline";

// Page size for `/digital-worker` infinite query.
// Sidebar consumes the same cache and reads only the first page.
export const DEFAULT_AGENTS_PAGE_SIZE = 30;

// Vite retains the build-only flag in development URLs. Remove that exact
// suffix so these trusted local assets also pass the normal safeIconUri guard.
function localAvatarSrc(src: string): string {
  return src.replace(/\?no-inline$/, "");
}

// Original portraits in row-major design order. Selection is local; only Save
// uploads the chosen PNG and receives the backend URI used to create the DW.
export const DW_AVATAR_PRESETS = [
  { id: "7661735044905435136", src: localAvatarSrc(avatar7661735044905435136) },
  { id: "7661735044892852224", src: localAvatarSrc(avatar7661735044892852224) },
  { id: "7661735044901240832", src: localAvatarSrc(avatar7661735044901240832) },
  { id: "7661735044934795264", src: localAvatarSrc(avatar7661735044934795264) },
  { id: "7661735044926406656", src: localAvatarSrc(avatar7661735044926406656) },
  { id: "7661735044884463616", src: localAvatarSrc(avatar7661735044884463616) },
  { id: "7661735051360468992", src: localAvatarSrc(avatar7661735051360468992) },
  { id: "7661735048449622016", src: localAvatarSrc(avatar7661735048449622016) },
  { id: "7661735051435982848", src: localAvatarSrc(avatar7661735051435982848) },
  { id: "7661735051435966464", src: localAvatarSrc(avatar7661735051435966464) },
  { id: "7661735051473715200", src: localAvatarSrc(avatar7661735051473715200) },
  { id: "7661735051519852544", src: localAvatarSrc(avatar7661735051519852544) },
  { id: "7661735054938210304", src: localAvatarSrc(avatar7661735054938210304) },
  { id: "7661735058029412352", src: localAvatarSrc(avatar7661735058029412352) },
  { id: "7661735057962303488", src: localAvatarSrc(avatar7661735057962303488) },
  { id: "7661735058012635136", src: localAvatarSrc(avatar7661735058012635136) },
  { id: "7661735057974886400", src: localAvatarSrc(avatar7661735057974886400) },
  { id: "7661735058180407296", src: localAvatarSrc(avatar7661735058180407296) },
] as const;

export type DwAvatarPreset = (typeof DW_AVATAR_PRESETS)[number];
