// Datalist shows 30-min suggestions; user can still type any time manually
export default function TimeInput({ value, onChange, id, required, placeholder }) {
    const listId = 'timelist-' + (id || 'default');
    const options = [];
    for (let h = 0; h < 24; h++) {
      for (const m of [0, 30]) {
        options.push(String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'));
      }
    }
    return (
      <>
        <input
          type="time"
          id={id}
          value={value}
          onChange={onChange}
          list={listId}
          required={required}
          placeholder={placeholder}
        />
        <datalist id={listId}>
          {options.map((t) => <option key={t} value={t} />)}
        </datalist>
      </>
    );
  }