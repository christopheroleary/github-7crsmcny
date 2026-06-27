import { useState, useEffect, useRef } from 'react';

export default function AddressAutocomplete({ value, onChange, placeholder }) {
  const [query, setQuery] = useState(value || '');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    setQuery(value || '');
  }, [value]);

  function handleInput(e) {
    const text = e.target.value;
    setQuery(text);
    onChange(text);

    clearTimeout(debounceRef.current);
    if (text.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://photon.komoot.io/api?q=${encodeURIComponent(text)}&limit=5`
        );
        const data = await res.json();
        setSuggestions(data.features || []);
        setOpen(true);
      } catch {
        setSuggestions([]);
      }
    }, 400);
  }

  function formatAddress(feature) {
    const p = feature.properties;
    return [
      [p.housenumber, p.street].filter(Boolean).join(' '),
      p.city,
      p.postcode,
      p.country,
    ]
      .filter(Boolean)
      .join(', ');
  }

  function handleSelect(feature) {
    const formatted = formatAddress(feature);
    setQuery(formatted);
    onChange(formatted);
    setSuggestions([]);
    setOpen(false);
  }

  return (
    <div className="address-autocomplete">
      <input
        type="text"
        value={query}
        onChange={handleInput}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <ul className="address-autocomplete__list">
          {suggestions.map((f, i) => (
            <li key={i} onClick={() => handleSelect(f)}>
              {formatAddress(f)}
            </li>
          ))}
        </ul>
      )}
      <p className="address-autocomplete__credit">Address search by OpenStreetMap</p>
    </div>
  );
}