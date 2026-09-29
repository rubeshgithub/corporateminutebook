import React, { useEffect, useRef, useState } from 'react';
import { Autocomplete, Box, Paper, TextField, Typography } from '@mui/material';
import type { PaperProps, TextFieldProps } from '@mui/material';

/**
 * Street-address field with Google Places suggestions.
 *
 * It is an ordinary MUI text field: whatever the user types is the value,
 * existing values show when editing, and validation styling works. Google
 * only supplies suggestions (Places API (New) AutocompleteSuggestion); picking
 * one fills in the address and reports its parts through `onPlaceSelected`.
 *
 * Without VITE_GOOGLE_PLACES_API_KEY, or if Google can't be reached, it is a
 * plain text field.
 */

export interface ParsedAddress {
    street: string;
    city: string;
    province: string;
    /** Short form, e.g. "AB". */
    provinceCode: string;
    postalCode: string;
    country: string;
    formatted: string;
}

type PlacesTextFieldProps = TextFieldProps & {
    onPlaceSelected?: (address: ParsedAddress) => void;
    /** Suggest addresses worldwide instead of Canada-only — for directors/shareholders residing abroad. */
    worldwide?: boolean;
    /** The field holds the whole address on one line, so a picked suggestion fills in the full address, not just the street. */
    fullAddress?: boolean;
};

interface Suggestion {
    id: string;
    main: string;
    secondary: string;
    full: string;
    prediction: any;
}

const API_KEY = import.meta.env.VITE_GOOGLE_PLACES_API_KEY;
const MIN_CHARS = 3;
const DEBOUNCE_MS = 250;

let placesPromise: Promise<any> | null = null;

/**
 * Loads the Maps JavaScript API once. The `callback` fires only after Google
 * has installed `google.maps.importLibrary` — the script's `onload` fires
 * before that with `loading=async`, so it can't be used as the ready signal.
 */
function loadPlaces(): Promise<any> {
    if (!API_KEY) return Promise.reject(new Error('No Places API key'));
    if (placesPromise) return placesPromise;
    const w = window as any;
    placesPromise = new Promise<void>((resolve, reject) => {
        if (w.google?.maps?.importLibrary) { resolve(); return; }
        const callback = '__minutebookPlacesReady';
        w[callback] = () => { delete w[callback]; resolve(); };
        const script = document.createElement('script');
        script.async = true;
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(API_KEY)}&v=weekly&loading=async&callback=${callback}`;
        script.onerror = () => reject(new Error('Google Maps script failed to load'));
        document.head.appendChild(script);
    })
        .then(() => w.google.maps.importLibrary('places'))
        .catch((err) => { placesPromise = null; throw err; });
    return placesPromise;
}

function parseComponents(components: any[]): Omit<ParsedAddress, 'formatted'> {
    const find = (type: string) => components.find((c) => (c.types ?? []).includes(type));
    const long = (type: string) => find(type)?.longText ?? find(type)?.long_name ?? '';
    const short = (type: string) => find(type)?.shortText ?? find(type)?.short_name ?? '';
    const street = [long('street_number'), long('route')].filter(Boolean).join(' ');
    const unit = long('subpremise');
    return {
        street: unit && street ? `${unit}-${street}` : street,
        city: long('locality') || long('postal_town') || long('sublocality_level_1') || long('administrative_area_level_3'),
        province: long('administrative_area_level_1'),
        provinceCode: short('administrative_area_level_1'),
        postalCode: long('postal_code'),
        country: long('country'),
    };
}

// Google requires attribution when its predictions are shown without a Google map.
const GooglePaper: React.FC<PaperProps> = ({ children, ...rest }) => (
    <Paper {...rest}>
        {children}
        <Box px={1.5} pb={0.75} textAlign="right">
            <Typography variant="caption" color="text.secondary">Powered by Google</Typography>
        </Box>
    </Paper>
);

const PlacesTextField = React.forwardRef<HTMLInputElement, PlacesTextFieldProps>(
    ({ onPlaceSelected, worldwide, fullAddress, onChange, value, ...props }, ref) => {
        const [places, setPlaces] = useState<any>(null);
        const [query, setQuery] = useState<string | null>(null);
        const [options, setOptions] = useState<Suggestion[]>([]);
        const sessionToken = useRef<any>(null);
        const lookup = useRef(0);
        const text = value == null ? '' : String(value);

        const emit = (str: string) => onChange?.({ target: { value: str } } as React.ChangeEvent<HTMLInputElement>);

        useEffect(() => {
            if (!API_KEY) return;
            let cancelled = false;
            loadPlaces().then((lib) => { if (!cancelled) setPlaces(lib); }).catch(() => { /* stays a plain field */ });
            return () => { cancelled = true; };
        }, []);

        // Suggestions follow what the user types, debounced; stale answers are dropped.
        useEffect(() => {
            if (!places || !query || query.trim().length < MIN_CHARS) { setOptions([]); return; }
            const id = ++lookup.current;
            const timer = window.setTimeout(async () => {
                try {
                    sessionToken.current ??= new places.AutocompleteSessionToken();
                    const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
                        input: query,
                        sessionToken: sessionToken.current,
                        ...(worldwide ? {} : { includedRegionCodes: ['ca'] }),
                    });
                    if (id !== lookup.current) return;
                    setOptions(suggestions
                        .filter((s: any) => s.placePrediction)
                        .map((s: any) => {
                            const p = s.placePrediction;
                            return {
                                id: p.placeId,
                                main: p.mainText?.text ?? p.text.text,
                                secondary: p.secondaryText?.text ?? '',
                                full: p.text.text,
                                prediction: p,
                            };
                        }));
                } catch {
                    if (id === lookup.current) setOptions([]);
                }
            }, DEBOUNCE_MS);
            return () => window.clearTimeout(timer);
        }, [places, query, worldwide]);

        const choose = async (s: Suggestion) => {
            lookup.current++;
            setQuery(null);
            setOptions([]);
            try {
                const place = s.prediction.toPlace();
                await place.fetchFields({ fields: ['addressComponents', 'formattedAddress'] });
                sessionToken.current = null; // a details request ends the billing session
                const parts = parseComponents(place.addressComponents ?? []);
                // Some suggestions resolve to the street itself, dropping the house number the user picked.
                const numberDropped = /^\d/.test(s.main) && !/^\d/.test(parts.street);
                if (numberDropped) parts.street = s.main;
                const address: ParsedAddress = { ...parts, formatted: numberDropped ? s.full : (place.formattedAddress ?? s.full) };
                emit(fullAddress ? address.formatted : (parts.street || address.formatted));
                onPlaceSelected?.(address);
            } catch {
                emit(s.full);
            }
        };

        if (!API_KEY) {
            return <TextField {...props} inputRef={ref} value={text} onChange={onChange} />;
        }

        return (
            <Autocomplete<Suggestion, false, true, true>
                freeSolo
                disableClearable
                options={options}
                filterOptions={(x) => x}
                getOptionLabel={(o) => (typeof o === 'string' ? o : o.full)}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                inputValue={text}
                // Only the user's typing changes the text; MUI's own resets are ignored.
                onInputChange={(_e, v, reason) => { if (reason === 'input') { emit(v); setQuery(v); } }}
                onChange={(_e, picked) => { if (picked && typeof picked !== 'string') choose(picked); }}
                value={text}
                fullWidth={props.fullWidth}
                size={props.size === 'small' ? 'small' : 'medium'}
                sx={props.sx}
                PaperComponent={GooglePaper}
                renderOption={({ key: _key, ...liProps }: React.HTMLAttributes<HTMLLIElement> & { key?: React.Key }, o) => (
                    <li {...liProps} key={o.id}>
                        <Box>
                            <Typography variant="body2">{o.main}</Typography>
                            {o.secondary && <Typography variant="caption" color="text.secondary">{o.secondary}</Typography>}
                        </Box>
                    </li>
                )}
                renderInput={(params) => (
                    <TextField
                        {...params}
                        {...props}
                        sx={undefined}
                        inputRef={ref}
                        InputProps={{ ...params.InputProps, ...props.InputProps }}
                        inputProps={{ ...params.inputProps, ...props.inputProps }}
                    />
                )}
            />
        );
    },
);

PlacesTextField.displayName = 'PlacesTextField';
export default PlacesTextField;
