import { focusOf } from "../navigation.ts";
import { EquipmentFaceplate } from "../faceplates/EquipmentFaceplate.tsx";
import { SingleLine } from "../sld/SingleLine.tsx";

/** L2: the single-line on the whole screen, with the faceplate of the selected equipment beside it. */
export function SubstationScreen({ focus, onFocus }: { focus: string | null; onFocus: (id: string | null) => void }) {
  const f = focus ? focusOf(focus) : null;
  return (
    <div className="stage">
      <div className={`stage-drawing${f ? " stage-drawing--with-panel" : ""}`}>
        <SingleLine selected={focus} onOpen={onFocus} />
      </div>
      {f && <EquipmentFaceplate key={focus} focus={f} onClose={() => onFocus(null)} />}
    </div>
  );
}
