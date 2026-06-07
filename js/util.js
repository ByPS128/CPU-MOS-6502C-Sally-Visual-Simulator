// --- Small formatting helpers -------------------------------------------------
function hex2(v) { return (v & 0xff).toString(16).toUpperCase().padStart(2, '0'); }
function hex4(v) { return (v & 0xffff).toString(16).toUpperCase().padStart(4, '0'); }
function bin8(v) { return (v & 0xff).toString(2).padStart(8, '0'); }
