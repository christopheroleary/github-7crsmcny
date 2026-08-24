export default function InstrumentPicker({ allInstruments, selectedIds, onAdd, onRemove }) {
    const available = allInstruments.filter((i) => !selectedIds.includes(i.id));
    const selected = allInstruments.filter((i) => selectedIds.includes(i.id));

    return (
      <div className="tag-input">
        <div className="tag-input__tags">
          {selected.map((i) => (
            <span className="tag" key={i.id}>
              {i.name}
              <button type="button" onClick={() => onRemove(i.id)} aria-label={`Remove ${i.name}`}>×</button>
            </span>
          ))}
        </div>
        <select value="" onChange={(e) => { if (e.target.value) onAdd(e.target.value); }}>
          <option value="">+ Add an instrument…</option>
          {available.map((i) => (
            <option key={i.id} value={i.id}>{i.name}</option>
          ))}
        </select>
      </div>
    );
  }
