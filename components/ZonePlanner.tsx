import React, { useCallback, useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import type { Feature, GeoJsonObject, Geometry, GeometryCollection, MultiPolygon, Polygon, Position } from 'geojson';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { supabase } from '../services/supabaseClient';
import { UserRole } from '../types';

interface Zone {
  id: string;
  nome: string;
  descricao?: string;
  cor: string;
  poligono_geojson: GeoJsonObject;
}

interface Member {
  id: string;
  nome: string;
}

type MemberLocationPin = {
  id: string;
  name: string;
  role?: string | null;
  location: { lat: number; lng: number };
  updatedAt: string;
};

interface Subzone {
  id: string;
  nome: string;
  descricao?: string;
  ordem?: number;
  zona_id: string;
  poligono_geojson?: GeoJsonObject | null;
}

type ActionStatus = 'PLANEJADA' | 'EM_ANDAMENTO' | 'CONCLUIDA' | 'CANCELADA';

interface SubzoneAction {
  id: string;
  subzona_id: string | null;
  zona_id?: string;
  data: string;
  titulo: string;
  descricao?: string;
  status: ActionStatus;
  observacoes?: string;
  responsavel_id?: string;
  membros?: Member | null;
}

interface ZoneLeaderAssignment {
  id: string;
  zona_id: string;
  lider_id: string;
  membros?: Member;
}

interface ZonePlannerProps {
  operationId?: string;
  stateCenter?: { lat: number; lng: number; zoom: number };
  readOnly?: boolean;
  viewer?: { id: string; role: UserRole };
}

const defaultCenter = { lat: -14.235, lng: -51.9253, zoom: 4 };
const ACTION_STATUS_OPTIONS: ActionStatus[] = ['PLANEJADA', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA'];
const formatActionDate = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
};

const collectPositions = (geojson?: GeoJsonObject | null): Position[] => {
  if (!geojson) return [];
  const pushCoords = (coords: any, acc: Position[]) => {
    if (!coords) return;
    if (typeof coords[0] === 'number') {
      acc.push(coords as Position);
    } else {
      coords.forEach((sub: any) => pushCoords(sub, acc));
    }
  };

  const extractGeometry = (geometry: Geometry | GeometryCollection | null | undefined, acc: Position[]) => {
    if (!geometry) return;
    if (geometry.type === 'GeometryCollection') {
      geometry.geometries.forEach((g) => extractGeometry(g, acc));
      return;
    }
    pushCoords((geometry as any).coordinates, acc);
  };

  const positions: Position[] = [];
  switch (geojson.type) {
    case 'Feature':
      extractGeometry((geojson as Feature).geometry, positions);
      break;
    case 'FeatureCollection':
      (geojson as any).features?.forEach((feature: Feature) => extractGeometry(feature.geometry, positions));
      break;
    default:
      extractGeometry(geojson as any, positions);
  }
  return positions;
};

const createBoundsFromPositions = (positions: Position[]): mapboxgl.LngLatBoundsLike | null => {
  if (!positions.length) return null;
  const nonEmpty = positions.filter((pos) => Array.isArray(pos) && typeof pos[0] === 'number' && typeof pos[1] === 'number');
  if (!nonEmpty.length) return null;
  const bounds = nonEmpty.reduce(
    (acc, curr) => acc.extend(curr as [number, number]),
    new mapboxgl.LngLatBounds(nonEmpty[0] as [number, number], nonEmpty[0] as [number, number])
  );
  return bounds;
};
const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN || '';
const ZONE_SCOPE = '__ZONE_SCOPE__';

if (mapboxToken) {
  mapboxgl.accessToken = mapboxToken;
}

type ActionFormState = {
  subzona_id: string;
  data: string;
  titulo: string;
  descricao: string;
  status: ActionStatus;
  observacoes: string;
  responsavel_id: string;
};

const emptySubzoneForm = { nome: '', descricao: '' };
const emptyActionForm: ActionFormState = {
  subzona_id: ZONE_SCOPE,
  data: '',
  titulo: '',
  descricao: '',
  status: 'PLANEJADA',
  observacoes: '',
  responsavel_id: ''
};

const ZonePlanner: React.FC<ZonePlannerProps> = ({ operationId, stateCenter, readOnly, viewer }) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const zoneSourceIdsRef = useRef<string[]>([]);
  const attributionControlRef = useRef<mapboxgl.AttributionControl | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingGeometry, setPendingGeometry] = useState<Feature<Polygon | MultiPolygon> | null>(null);
  const [zoneName, setZoneName] = useState('');
  const [zoneDescription, setZoneDescription] = useState('');
  const [zoneColor, setZoneColor] = useState('#6366F1');
  const [saving, setSaving] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [leaders, setLeaders] = useState<Member[]>([]);
  const [zoneLeaders, setZoneLeaders] = useState<Record<string, ZoneLeaderAssignment[]>>({});
  const [leaderInput, setLeaderInput] = useState<Record<string, string>>({});
  const [zoneForm, setZoneForm] = useState<Record<string, { nome: string; descricao: string; cor: string }>>({});
  const [zoneSavingMap, setZoneSavingMap] = useState<Record<string, boolean>>({});
  const [leaderAssigning, setLeaderAssigning] = useState<Record<string, boolean>>({});
  const [activeDrawingZoneId, setActiveDrawingZoneId] = useState<string | null>(null);
  const [pendingTargetZoneId, setPendingTargetZoneId] = useState<string | null>(null);
  const [targetZoneForDrawing, setTargetZoneForDrawing] = useState<string | null>(null);
  const [subzoneForm, setSubzoneForm] = useState<Record<string, { nome: string; descricao: string }>>({});
  const [subzoneSaving, setSubzoneSaving] = useState<Record<string, boolean>>({});
  const [zoneSubzones, setZoneSubzones] = useState<Record<string, Subzone[]>>({});
  const [zoneActions, setZoneActions] = useState<Record<string, SubzoneAction[]>>({});
  const [actionForm, setActionForm] = useState<Record<string, ActionFormState>>({});
  const [actionSaving, setActionSaving] = useState<Record<string, boolean>>({});
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [editActionForm, setEditActionForm] = useState<Record<string, ActionFormState>>({});
  const [editActionSaving, setEditActionSaving] = useState<Record<string, boolean>>({});
  const [zoneDeleting, setZoneDeleting] = useState<Record<string, boolean>>({});
  const [subzoneDeleting, setSubzoneDeleting] = useState<Record<string, boolean>>({});
  const [memberPins, setMemberPins] = useState<MemberLocationPin[]>([]);
  const memberMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const canEdit = !readOnly;
  const pendingZoneTarget = pendingTargetZoneId
    ? zones.find((zone) => zone.id === pendingTargetZoneId) || null
    : null;

  useEffect(() => {
    const fetchZones = async () => {
      if (!supabase || !operationId) {
        setZones([]);
        return;
      }
      setLoading(true);
      setError(null);
      const { data, error: fetchError } = await supabase
        .from('zonas')
        .select('id, nome, descricao, cor, poligono_geojson')
        .eq('operacao_id', operationId)
        .order('created_at', { ascending: false });
      if (fetchError) {
        setError('Não foi possível carregar as zonas.');
      } else {
        setZones(data || []);
      }
      setLoading(false);
    };
    fetchZones();
  }, [operationId]);

  useEffect(() => {
    setZoneForm((prev) => {
      const next = { ...prev };
      zones.forEach((zone) => {
        if (!next[zone.id]) {
          next[zone.id] = {
            nome: zone.nome,
            descricao: zone.descricao || '',
            cor: zone.cor || '#6366F1'
          };
        }
      });
      Object.keys(next).forEach((id) => {
        if (!zones.some((zone) => zone.id === id)) {
          delete next[id];
        }
      });
      return next;
    });
  }, [zones]);

  const hasInitializedSelection = useRef(false);

  useEffect(() => {
    if (zones.length === 0) {
      setSelectedZoneId(null);
      hasInitializedSelection.current = false;
      return;
    }
    if (!hasInitializedSelection.current) {
      setSelectedZoneId(zones[0].id);
      hasInitializedSelection.current = true;
      return;
    }
    if (selectedZoneId && !zones.some((zone) => zone.id === selectedZoneId)) {
      setSelectedZoneId(null);
    }
  }, [zones, selectedZoneId]);

  useEffect(() => {
    setLeaderInput((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((zoneId) => {
        if (!zones.some((zone) => zone.id === zoneId)) {
          delete next[zoneId];
        }
      });
      return next;
    });
  }, [zones]);

  useEffect(() => {
    const fetchLeaders = async () => {
      if (!supabase || !operationId) {
        setLeaders([]);
        return;
      }
      const { data, error: leadersError } = await supabase
        .from('membros')
        .select('id, nome')
        .eq('operacao_id', operationId)
        .eq('tipo', 'LEADER');
      if (leadersError) {
        console.error('Erro ao carregar líderes da operação', leadersError);
        return;
      }
      setLeaders(data || []);
    };
    fetchLeaders();
  }, [operationId]);

  useEffect(() => {
    let timer: number | null = null;

    const fetchMemberLocations = async () => {
      if (!supabase || !operationId || !viewer || viewer.role === UserRole.SOLDIER) {
        setMemberPins([]);
        return;
      }

      let query = supabase
        .from('membros')
        .select('id, nome, tipo, last_location, last_location_at, responsavel_id')
        .eq('operacao_id', operationId);

      if (viewer.role !== UserRole.DIRECTOR) {
        query = query.eq('responsavel_id', viewer.id).eq('tipo', 'SOLDIER');
      }

      const { data, error: membersError } = await query;

      if (membersError) {
        console.error('Erro ao carregar localização dos membros', membersError);
        return;
      }

      const pins: MemberLocationPin[] = [];
      (data || []).forEach((member: any) => {
        const loc = member.last_location;
        if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return;
        const updatedAt = member.last_location_at || new Date().toISOString();
        pins.push({
          id: member.id,
          name: member.nome || 'Colaborador',
          role: member.tipo || null,
          location: { lat: loc.lat, lng: loc.lng },
          updatedAt
        });
      });
      setMemberPins(pins);
    };

    fetchMemberLocations();
    timer = window.setInterval(fetchMemberLocations, 60_000);

    return () => {
      if (timer) window.clearInterval(timer);
    };
  }, [operationId, viewer]);

  useEffect(() => {
    const fetchAssignments = async () => {
      if (!supabase || !operationId || zones.length === 0) {
        setZoneLeaders({});
        return;
      }
      const zoneIds = zones.map((zone) => zone.id);
      const { data, error: assignmentsError } = await supabase
        .from('zona_lideres')
        .select('id, zona_id, lider_id, membros:lider_id(id, nome)')
        .in('zona_id', zoneIds);
      if (assignmentsError) {
        console.error('Erro ao carregar líderes das zonas', assignmentsError);
        return;
      }
      const grouped: Record<string, ZoneLeaderAssignment[]> = {};
      (data || []).forEach((assignment) => {
        const zoneId = assignment.zona_id;
        if (!grouped[zoneId]) grouped[zoneId] = [];
        grouped[zoneId].push(assignment as ZoneLeaderAssignment);
      });
      setZoneLeaders(grouped);
    };
    fetchAssignments();
  }, [operationId, zones]);

  useEffect(() => {
    const fetchSubzones = async () => {
      if (!supabase || zones.length === 0) {
        setZoneSubzones({});
        return;
      }
      const { data, error: subzonaError } = await supabase
        .from('subzonas')
        .select('id, zona_id, nome, descricao, ordem, poligono_geojson')
        .in('zona_id', zones.map((zone) => zone.id));
      if (subzonaError) {
        console.error('Erro ao carregar subzonas', subzonaError);
        return;
      }
      const grouped: Record<string, Subzone[]> = {};
      (data || []).forEach((subzona) => {
        if (!grouped[subzona.zona_id]) grouped[subzona.zona_id] = [];
        grouped[subzona.zona_id].push(subzona as Subzone);
      });
      setZoneSubzones(grouped);
    };
    fetchSubzones();
  }, [zones]);

  useEffect(() => {
    const fetchActions = async () => {
      if (!supabase || zones.length === 0) {
        setZoneActions({});
        return;
      }
      const zoneIds = zones.map((zone) => zone.id);
      const { data, error: actionsError } = await supabase
        .from('subzona_acoes')
        .select(
          'id, zona_id, subzona_id, data, titulo, descricao, status, observacoes, responsavel_id, membros:responsavel_id(id, nome)'
        )
        .in('zona_id', zoneIds)
        .order('data', { ascending: true });
      if (actionsError) {
        console.error('Erro ao carregar ações das zonas', actionsError);
        return;
      }
      const grouped: Record<string, SubzoneAction[]> = {};
      const subzoneLookup: Record<string, string> = {};
      Object.values(zoneSubzones)
        .flat()
        .forEach((subzona) => {
          subzoneLookup[subzona.id] = subzona.zona_id;
        });
      (data || []).forEach((action) => {
        const zoneId = action.zona_id || (action.subzona_id ? subzoneLookup[action.subzona_id] : undefined);
        if (!zoneId) return;
        if (!grouped[zoneId]) grouped[zoneId] = [];
        grouped[zoneId].push(action as SubzoneAction);
      });
      setZoneActions(grouped);
    };
    fetchActions();
  }, [zones, zoneSubzones]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const markers = memberMarkersRef.current;
    const nextIds = new Set(memberPins.map((pin) => pin.id));

    markers.forEach((marker, id) => {
      if (!nextIds.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    });

    memberPins.forEach((pin) => {
      const existing = markers.get(pin.id);
      const lngLat: [number, number] = [pin.location.lng, pin.location.lat];

      if (existing) {
        existing.setLngLat(lngLat);
        return;
      }

      const color = pin.role === 'LEADER' ? '#f97316' : '#22c55e';
      const marker = new mapboxgl.Marker({ color })
        .setLngLat(lngLat)
        .setPopup(
          new mapboxgl.Popup({ offset: 18 }).setHTML(
            `<div style="font-size:12px;">
              <strong>${pin.name}</strong><br />
              Última atualização: ${new Date(pin.updatedAt).toLocaleString('pt-BR')}
            </div>`
          )
        )
        .addTo(map);
      markers.set(pin.id, marker);
    });
  }, [memberPins, mapReady]);

  const handleDrawCreate = useCallback(
    (event: any) => {
      if (!canEdit) return;
      const features: Feature[] = event.features || [];
      if (!features.length) return;
      const feature = features[0] as Feature<Polygon | MultiPolygon>;
      if (drawRef.current && feature.id) {
        drawRef.current.delete(feature.id as string);
      }
      setPendingGeometry(feature);
      setZoneName('');
      setZoneDescription('');
      setZoneColor('#6366F1');
      setPendingTargetZoneId(activeDrawingZoneId);
      setTargetZoneForDrawing(null);
      setActiveDrawingZoneId(null);
    },
    [activeDrawingZoneId, canEdit]
  );

  useEffect(() => {
    if (!mapboxToken || !operationId || mapRef.current || !mapContainerRef.current) return;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [defaultCenter.lng, defaultCenter.lat],
      zoom: defaultCenter.zoom,
      attributionControl: false
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');
    const attribution = new mapboxgl.AttributionControl({
      compact: true,
      customAttribution: 'iArgos • Dados © Mapbox & OpenStreetMap'
    });
    map.addControl(attribution, 'bottom-left');
    attributionControlRef.current = attribution;

    if (!readOnly) {
      const draw = new MapboxDraw({
        displayControlsDefault: false,
        controls: {
          polygon: true,
          trash: false
        },
        defaultMode: 'draw_polygon',
        styles: [
          {
            id: 'gl-draw-polygon-fill',
            type: 'fill',
            filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
            paint: {
              'fill-color': '#4F46E5',
              'fill-opacity': 0.25
            }
          },
          {
            id: 'gl-draw-polygon-stroke-active',
            type: 'line',
            filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
            paint: {
              'line-color': '#4F46E5',
              'line-width': 2
            }
          }
        ]
      });
      drawRef.current = draw;
      map.addControl(draw, 'top-right');
      map.on('draw.create', handleDrawCreate);
    }

    map.on('load', () => {
      setMapReady(true);
    });

    return () => {
      if (drawRef.current) {
        map.off('draw.create', handleDrawCreate);
        map.removeControl(drawRef.current);
        drawRef.current = null;
      }
      if (attributionControlRef.current) {
        map.removeControl(attributionControlRef.current);
        attributionControlRef.current = null;
      }
      zoneSourceIdsRef.current = [];
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [handleDrawCreate, operationId, readOnly]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && stateCenter && mapReady) {
      map.flyTo({ center: [stateCenter.lng, stateCenter.lat], zoom: stateCenter.zoom });
    }
  }, [stateCenter, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    zoneSourceIdsRef.current.forEach((id) => {
      if (map.getLayer(`zone-fill-${id}`)) map.removeLayer(`zone-fill-${id}`);
      if (map.getLayer(`zone-line-${id}`)) map.removeLayer(`zone-line-${id}`);
      if (map.getSource(`zone-${id}`)) map.removeSource(`zone-${id}`);
    });
    zoneSourceIdsRef.current = [];

    zones.forEach((zone) => {
      const sourceId = `zone-${zone.id}`;
      map.addSource(sourceId, {
        type: 'geojson',
        data: zone.poligono_geojson as GeoJsonObject
      });

      map.addLayer({
        id: `zone-fill-${zone.id}`,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': zone.cor || '#6366F1',
          'fill-opacity': 0.25
        }
      });

      map.addLayer({
        id: `zone-line-${zone.id}`,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': zone.cor || '#6366F1',
          'line-width': 2
        }
      });

      zoneSourceIdsRef.current.push(zone.id);
    });
  }, [zones, mapReady]);

  const handleSaveZone = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pendingGeometry || !operationId || !supabase) return;
    if (pendingTargetZoneId) {
      const zoneId = pendingTargetZoneId;
      setZoneSavingMap((prev) => ({ ...prev, [zoneId]: true }));
      try {
        const { data, error: updateError } = await supabase
          .from('zonas')
          .update({ poligono_geojson: pendingGeometry })
          .eq('id', zoneId)
          .select('id, nome, descricao, cor, poligono_geojson')
          .single();
        if (updateError) throw updateError;
        if (data) {
          setZones((prev) => prev.map((zone) => (zone.id === data.id ? data : zone)));
          setZoneForm((prev) => ({
            ...prev,
            [zoneId]: {
              nome: data.nome,
              descricao: data.descricao || '',
              cor: data.cor || '#6366F1'
            }
          }));
        }
        setPendingGeometry(null);
        setPendingTargetZoneId(null);
      } catch (err) {
        console.error('Erro ao atualizar área da zona', err);
        setError('Não foi possível atualizar a área da zona agora.');
      } finally {
        setZoneSavingMap((prev) => ({ ...prev, [zoneId]: false }));
      }
      return;
    }
    if (!zoneName.trim()) {
      setError('Informe um nome para a zona.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload = {
        operacao_id: operationId,
        nome: zoneName.trim(),
        descricao: zoneDescription.trim() || null,
        cor: zoneColor,
        poligono_geojson: pendingGeometry
      };
      const { data, error: insertError } = await supabase
        .from('zonas')
        .insert(payload)
        .select('id, nome, descricao, cor, poligono_geojson')
        .single();
      if (insertError) throw insertError;
      if (data) {
        setZones((prev) => [data, ...prev]);
        setPendingGeometry(null);
        setZoneName('');
        setZoneDescription('');
      }
    } catch (err) {
      console.error('Erro ao salvar zona', err);
      setError('Não conseguimos salvar a zona agora.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelPending = () => {
    setPendingGeometry(null);
    setZoneName('');
    setZoneDescription('');
    setPendingTargetZoneId(null);
    setTargetZoneForDrawing(null);
    setActiveDrawingZoneId(null);
  };

  const handleStartDrawing = (zoneId?: string) => {
    if (!canEdit || !mapReady || !drawRef.current) return;
    const targetId = zoneId || null;
    setActiveDrawingZoneId(targetId);
    setTargetZoneForDrawing(targetId);
    setPendingGeometry(null);
    setPendingTargetZoneId(null);
    drawRef.current.deleteAll();
    drawRef.current.changeMode('draw_polygon');
  };

  const handleZoneFieldChange = (zoneId: string, field: 'nome' | 'descricao' | 'cor', value: string) => {
    setZoneForm((prev) => ({
      ...prev,
      [zoneId]: {
        ...(prev[zoneId] || { nome: '', descricao: '', cor: '#6366F1' }),
        [field]: value
      }
    }));
  };

  const focusGeometry = (geometry?: GeoJsonObject | null) => {
    if (!mapRef.current || !geometry) return;
    const positions = collectPositions(geometry);
    const bounds = createBoundsFromPositions(positions);
    if (!bounds) return;
    mapRef.current.fitBounds(bounds, { padding: 60, duration: 1000 });
  };

  const handleFocusZone = (zone: Zone) => {
    if (zone.poligono_geojson) {
      focusGeometry(zone.poligono_geojson);
    }
  };

  const handleFocusSubzone = (zone: Zone, subzone: Subzone) => {
    if (subzone.poligono_geojson) {
      focusGeometry(subzone.poligono_geojson);
      return;
    }
    handleFocusZone(zone);
  };

  const handleSubzoneFieldChange = (zoneId: string, field: 'nome' | 'descricao', value: string) => {
    setSubzoneForm((prev) => ({
      ...prev,
      [zoneId]: {
        ...(prev[zoneId] || emptySubzoneForm),
        [field]: value
      }
    }));
  };

  const handleCreateSubzone = async (zoneId: string) => {
    if (!canEdit || !supabase) return;
    const formState = subzoneForm[zoneId] || emptySubzoneForm;
    if (!formState.nome.trim()) {
      setError('Informe um nome para a subzona.');
      return;
    }
    setSubzoneSaving((prev) => ({ ...prev, [zoneId]: true }));
    try {
      const payload = {
        zona_id: zoneId,
        nome: formState.nome.trim(),
        descricao: formState.descricao.trim() || null,
        ordem: (zoneSubzones[zoneId]?.length || 0) + 1
      };
      const { data, error: insertError } = await supabase
        .from('subzonas')
        .insert(payload)
        .select('id, zona_id, nome, descricao, ordem')
        .single();
      if (insertError) throw insertError;
      if (data) {
        setZoneSubzones((prev) => ({
          ...prev,
          [zoneId]: [...(prev[zoneId] || []), data as Subzone]
        }));
        setSubzoneForm((prev) => ({
          ...prev,
          [zoneId]: { ...emptySubzoneForm }
        }));
      }
    } catch (err) {
      console.error('Erro ao cadastrar subzona', err);
      setError('Não foi possível salvar a subzona agora.');
    } finally {
      setSubzoneSaving((prev) => ({ ...prev, [zoneId]: false }));
    }
  };

  const handleActionFieldChange = <K extends keyof ActionFormState>(
    zoneId: string,
    field: K,
    value: ActionFormState[K]
  ) => {
    setActionForm((prev) => {
      const previous = prev[zoneId] || emptyActionForm;
      return {
        ...prev,
        [zoneId]: {
          ...previous,
          [field]: value
        }
      };
    });
  };

  const handleCreateAction = async (zoneId: string) => {
    if (!canEdit || !supabase) return;
    const formState = actionForm[zoneId] || emptyActionForm;
    const isZoneScope = formState.subzona_id === ZONE_SCOPE;
    if (!isZoneScope && !formState.subzona_id) {
      setError('Selecione o alvo da ação (zona inteira ou subzona).');
      return;
    }
    if (!formState.data) {
      setError('Informe a data da ação.');
      return;
    }
    if (!formState.titulo.trim()) {
      setError('Informe o título da ação.');
      return;
    }
    setActionSaving((prev) => ({ ...prev, [zoneId]: true }));
    try {
      const payload = {
        zona_id: zoneId,
        subzona_id: isZoneScope ? null : formState.subzona_id,
        data: formState.data,
        titulo: formState.titulo.trim(),
        descricao: formState.descricao.trim() || null,
        status: formState.status,
        observacoes: formState.observacoes.trim() || null,
        responsavel_id: formState.responsavel_id || null
      };
      const { data, error: insertError } = await supabase
        .from('subzona_acoes')
        .insert(payload)
        .select(
          'id, subzona_id, data, titulo, descricao, status, observacoes, responsavel_id, membros:responsavel_id(id, nome)'
        )
        .single();
      if (insertError) throw insertError;
      if (data) {
        const targetZoneId = data.zona_id || zoneId;
        setZoneActions((prev) => ({
          ...prev,
          [targetZoneId]: [...(prev[targetZoneId] || []), data as SubzoneAction]
        }));
        setActionForm((prev) => {
          const previous = prev[zoneId] || emptyActionForm;
          return {
            ...prev,
            [zoneId]: {
              ...previous,
              subzona_id: ZONE_SCOPE,
              data: '',
              titulo: '',
              descricao: '',
              observacoes: ''
            }
          };
        });
      }
    } catch (err) {
      console.error('Erro ao cadastrar ação tática', err);
      setError('Não foi possível salvar a ação agora.');
    } finally {
      setActionSaving((prev) => ({ ...prev, [zoneId]: false }));
    }
  };

  const handleStartEditAction = (action: SubzoneAction) => {
    setEditingActionId(action.id);
    setEditActionForm((prev) => ({
      ...prev,
      [action.id]: {
        subzona_id: action.subzona_id || ZONE_SCOPE,
        data: action.data ? action.data.substring(0, 10) : '',
        titulo: action.titulo,
        descricao: action.descricao || '',
        status: action.status,
        observacoes: action.observacoes || '',
        responsavel_id: action.responsavel_id || ''
      }
    }));
  };

  const handleEditActionFieldChange = <K extends keyof ActionFormState>(
    actionId: string,
    field: K,
    value: ActionFormState[K]
  ) => {
    setEditActionForm((prev) => {
      const previous = prev[actionId] || emptyActionForm;
      return {
        ...prev,
        [actionId]: {
          ...previous,
          [field]: value
        }
      };
    });
  };

  const handleCancelEditAction = () => {
    setEditingActionId(null);
  };

  const handleUpdateAction = async (zoneId: string, actionId: string) => {
    if (!canEdit || !supabase) return;
    const formState = editActionForm[actionId];
    if (!formState) {
      setError('Selecione o alvo da ação.');
      return;
    }
    const isZoneScope = formState.subzona_id === ZONE_SCOPE;
    if (!isZoneScope && !formState.subzona_id) {
      setError('Selecione o alvo da ação (zona inteira ou subzona).');
      return;
    }
    if (!formState.data) {
      setError('Informe a data da ação.');
      return;
    }
    if (!formState.titulo.trim()) {
      setError('Informe o título da ação.');
      return;
    }
    setEditActionSaving((prev) => ({ ...prev, [actionId]: true }));
    try {
      const payload = {
        zona_id: zoneId,
        subzona_id: isZoneScope ? null : formState.subzona_id,
        data: formState.data,
        titulo: formState.titulo.trim(),
        descricao: formState.descricao.trim() || null,
        status: formState.status,
        observacoes: formState.observacoes.trim() || null,
        responsavel_id: formState.responsavel_id || null
      };
      const { data, error: updateError } = await supabase
        .from('subzona_acoes')
        .update(payload)
        .eq('id', actionId)
        .select(
          'id, subzona_id, data, titulo, descricao, status, observacoes, responsavel_id, membros:responsavel_id(id, nome)'
        )
        .single();
      if (updateError) throw updateError;
      if (data) {
        setZoneActions((prev) => {
          const next = { ...prev };
          Object.keys(next).forEach((zoneKey) => {
            next[zoneKey] = (next[zoneKey] || []).filter((action) => action.id !== actionId);
          });
          const zoneKey = data.zona_id || zoneId;
          next[zoneKey] = [...(next[zoneKey] || []), data as SubzoneAction];
          return next;
        });
      }
      setEditingActionId(null);
    } catch (err) {
      console.error('Erro ao atualizar ação tática', err);
      setError('Não foi possível atualizar a ação agora.');
    } finally {
      setEditActionSaving((prev) => ({ ...prev, [actionId]: false }));
    }
  };

  const handleZoneUpdate = async (zoneId: string) => {
    if (!canEdit || !supabase) return;
    const formState = zoneForm[zoneId];
    if (!formState || !formState.nome.trim()) {
      setError('Informe o nome da zona.');
      return;
    }
    setZoneSavingMap((prev) => ({ ...prev, [zoneId]: true }));
    try {
      const payload = {
        nome: formState.nome.trim(),
        descricao: formState.descricao.trim() || null,
        cor: formState.cor || '#6366F1'
      };
      const { data, error: updateError } = await supabase
        .from('zonas')
        .update(payload)
        .eq('id', zoneId)
        .select('id, nome, descricao, cor, poligono_geojson')
        .single();
      if (updateError) throw updateError;
      if (data) {
        setZones((prev) => prev.map((zone) => (zone.id === data.id ? data : zone)));
        setZoneForm((prev) => ({
          ...prev,
          [zoneId]: {
            nome: data.nome,
            descricao: data.descricao || '',
            cor: data.cor || '#6366F1'
          }
        }));
      }
    } catch (err) {
      console.error('Erro ao atualizar zona', err);
      setError('Não foi possível atualizar a zona agora.');
    } finally {
      setZoneSavingMap((prev) => ({ ...prev, [zoneId]: false }));
    }
  };

  const handleAssignLeader = async (zoneId: string) => {
    if (!canEdit || !supabase) return;
    const leaderId = leaderInput[zoneId];
    if (!leaderId) return;
    if (zoneLeaders[zoneId]?.some((assignment) => assignment.lider_id === leaderId)) {
      setLeaderInput((prev) => ({ ...prev, [zoneId]: '' }));
      return;
    }
    setLeaderAssigning((prev) => ({ ...prev, [zoneId]: true }));
    try {
      const { data, error: insertError } = await supabase
        .from('zona_lideres')
        .insert({ zona_id: zoneId, lider_id: leaderId })
        .select('id, zona_id, lider_id, membros:lider_id(id, nome)')
        .single();
      if (insertError) throw insertError;
      if (data) {
        setZoneLeaders((prev) => ({
          ...prev,
          [zoneId]: [...(prev[zoneId] || []), data as ZoneLeaderAssignment]
        }));
        setLeaderInput((prev) => ({ ...prev, [zoneId]: '' }));
      }
    } catch (err) {
      console.error('Erro ao atribuir líder', err);
      setError('Não foi possível atribuir o líder agora.');
    } finally {
      setLeaderAssigning((prev) => ({ ...prev, [zoneId]: false }));
    }
  };

  const handleRemoveLeader = async (zoneId: string, assignmentId: string) => {
    if (!canEdit || !supabase) return;
    try {
      const { error: deleteError } = await supabase.from('zona_lideres').delete().eq('id', assignmentId);
      if (deleteError) throw deleteError;
      setZoneLeaders((prev) => ({
        ...prev,
        [zoneId]: (prev[zoneId] || []).filter((assignment) => assignment.id !== assignmentId)
      }));
    } catch (err) {
      console.error('Erro ao remover líder da zona', err);
      setError('Não foi possível remover o líder agora.');
    }
  };

  const handleDeleteZone = async (zoneId: string) => {
    if (!canEdit || !supabase) return;
    const confirmationMessage = 'Deseja realmente remover esta zona? As subzonas e ações associadas serão excluídas.';
    if (typeof window !== 'undefined' && !window.confirm(confirmationMessage)) {
      return;
    }
    setZoneDeleting((prev) => ({ ...prev, [zoneId]: true }));
    try {
      const relatedSubzones = zoneSubzones[zoneId] || [];
      const subzoneIds = relatedSubzones.map((subzona) => subzona.id);
      if (subzoneIds.length > 0) {
        await supabase.from('subzona_acoes').delete().in('subzona_id', subzoneIds);
        await supabase.from('subzonas').delete().in('id', subzoneIds);
      }
      const { error: deleteZoneError } = await supabase.from('zonas').delete().eq('id', zoneId);
      if (deleteZoneError) throw deleteZoneError;
      setZones((prev) => prev.filter((zone) => zone.id !== zoneId));
      setZoneForm((prev) => {
        const next = { ...prev };
        delete next[zoneId];
        return next;
      });
      setZoneLeaders((prev) => {
        const next = { ...prev };
        delete next[zoneId];
        return next;
      });
      setLeaderInput((prev) => {
        const next = { ...prev };
        delete next[zoneId];
        return next;
      });
      setZoneSavingMap((prev) => {
        const next = { ...prev };
        delete next[zoneId];
        return next;
      });
      setSubzoneForm((prev) => {
        const next = { ...prev };
        delete next[zoneId];
        return next;
      });
      setSubzoneSaving((prev) => {
        const next = { ...prev };
        delete next[zoneId];
        return next;
      });
      setActionForm((prev) => {
        const next = { ...prev };
        delete next[zoneId];
        return next;
      });
      setActionSaving((prev) => {
        const next = { ...prev };
        delete next[zoneId];
        return next;
      });
      setZoneSubzones((prev) => {
        const next = { ...prev };
        delete next[zoneId];
        return next;
      });
      setZoneActions((prev) => {
        const next = { ...prev };
        delete next[zoneId];
        return next;
      });
      setSelectedZoneId((prev) => (prev === zoneId ? null : prev));
    } catch (err) {
      console.error('Erro ao remover zona', err);
      setError('Não foi possível remover a zona agora.');
    } finally {
      setZoneDeleting((prev) => ({ ...prev, [zoneId]: false }));
    }
  };

  const handleDeleteSubzone = async (zoneId: string, subzoneId: string) => {
    if (!canEdit || !supabase) return;
    const confirmationMessage = 'Deseja remover esta subzona? Todas as ações vinculadas serão excluídas.';
    if (typeof window !== 'undefined' && !window.confirm(confirmationMessage)) {
      return;
    }
    setSubzoneDeleting((prev) => ({ ...prev, [subzoneId]: true }));
    try {
      await supabase.from('subzona_acoes').delete().eq('subzona_id', subzoneId);
      const { error: deleteError } = await supabase.from('subzonas').delete().eq('id', subzoneId);
      if (deleteError) throw deleteError;
      setZoneSubzones((prev) => ({
        ...prev,
        [zoneId]: (prev[zoneId] || []).filter((subzona) => subzona.id !== subzoneId)
      }));
      setZoneActions((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((zoneKey) => {
          next[zoneKey] = (next[zoneKey] || []).filter((action) => action.subzona_id !== subzoneId);
        });
        return next;
      });
    } catch (err) {
      console.error('Erro ao remover subzona', err);
      setError('Não foi possível remover a subzona agora.');
    } finally {
      setSubzoneDeleting((prev) => ({ ...prev, [subzoneId]: false }));
    }
  };

  if (!mapboxToken) {
    return (
      <div className="w-full h-[500px] bg-slate-200 rounded-3xl flex items-center justify-center border border-dashed border-slate-400 text-slate-500 text-sm text-center">
        Configure o token do Mapbox (VITE_MAPBOX_TOKEN) para habilitar o mapa estratégico.
      </div>
    );
  }

  if (!operationId) {
    return (
      <div className="w-full h-[500px] bg-slate-200 rounded-3xl flex items-center justify-center border border-dashed border-slate-400 text-slate-500 text-sm">
        Configure a operação para liberar o mapa estratégico.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="w-full h-[620px]" ref={mapContainerRef} />

      <div className="p-6 space-y-4">
        {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-xl border border-red-100">{error}</div>}
        {canEdit && (
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-indigo-50 border border-indigo-100 rounded-2xl p-4">
            <div>
              <p className="text-sm font-bold text-indigo-900">Desenhar nova zona</p>
              <p className="text-xs text-indigo-700">Clique em “Iniciar desenho” e marque os pontos no mapa.</p>
            </div>
            <button
              type="button"
              onClick={() => handleStartDrawing()}
              disabled={!mapReady}
              className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Iniciar desenho
            </button>
          </div>
        )}

        {pendingGeometry && canEdit && pendingZoneTarget && (
          <form onSubmit={handleSaveZone} className="space-y-3 bg-slate-50 border border-slate-200 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                  <i className="fas fa-vector-square text-indigo-500"></i> Atualizar área
                </h4>
                <p className="text-xs text-slate-500">Zona: {pendingZoneTarget.nome}</p>
              </div>
              <button
                type="button"
                className="text-xs text-slate-500 hover:text-red-500"
                onClick={handleCancelPending}
              >
                Cancelar
              </button>
            </div>
            <p className="text-xs text-slate-600">
              Confirme para substituir o polígono atual com o novo desenho aplicado no mapa.
            </p>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Aplicar nova área
              </button>
            </div>
          </form>
        )}

        {pendingGeometry && canEdit && !pendingZoneTarget && (
          <form onSubmit={handleSaveZone} className="space-y-3 bg-slate-50 border border-slate-200 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                <i className="fas fa-draw-polygon text-indigo-500"></i> Nova zona
              </h4>
              <button
                type="button"
                className="text-xs text-slate-500 hover:text-red-500"
                onClick={handleCancelPending}
              >
                Cancelar
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Nome</label>
                <input
                  type="text"
                  value={zoneName}
                  onChange={(e) => setZoneName(e.target.value)}
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                  placeholder="Zona Norte, etc."
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Cor</label>
                <input
                  type="color"
                  value={zoneColor}
                  onChange={(e) => setZoneColor(e.target.value)}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 p-1"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase">Descrição</label>
              <textarea
                value={zoneDescription}
                onChange={(e) => setZoneDescription(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                rows={2}
                placeholder="Observações gerais da zona..."
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 rounded-2xl bg-indigo-600 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-save"></i>}
              Registrar Zona
            </button>
          </form>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-bold text-slate-700 flex items-center gap-2">
              <i className="fas fa-layer-group text-indigo-500"></i> Zonas cadastradas
            </h4>
            {loading && <span className="text-xs text-slate-400">Atualizando...</span>}
          </div>
          {zones.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nenhuma zona registrada. Utilize o botão de desenho no mapa para iniciar o planejamento territorial.
            </p>
          ) : (
            <div className="space-y-3">
              {zones.map((zone) => {
                const expanded = selectedZoneId === zone.id;
                const formState = zoneForm[zone.id] || {
                  nome: zone.nome,
                  descricao: zone.descricao || '',
                  cor: zone.cor || '#6366F1'
                };
                const assignments = zoneLeaders[zone.id] || [];
                const availableLeaders = leaders.filter(
                  (leader) => !assignments.some((assignment) => assignment.lider_id === leader.id)
                );
                const currentLeaderInput = leaderInput[zone.id] || '';
                const subzones = zoneSubzones[zone.id] || [];
                const actionState = actionForm[zone.id] || emptyActionForm;
                const subzoneLookup: Record<string, Subzone> = {};
                subzones.forEach((subzona) => {
                  subzoneLookup[subzona.id] = subzona;
                });
                const actionTimeline = (zoneActions[zone.id] || [])
                  .map((action) => ({
                    subzona: action.subzona_id ? subzoneLookup[action.subzona_id] || null : null,
                    action
                  }))
                  .sort((a, b) => {
                    const aTime = new Date(a.action.data).getTime();
                    const bTime = new Date(b.action.data).getTime();
                    const safeA = Number.isNaN(aTime) ? 0 : aTime;
                    const safeB = Number.isNaN(bTime) ? 0 : bTime;
                    return safeA - safeB;
                  });
                return (
                  <div key={zone.id} className="border border-slate-200 rounded-2xl p-4">
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setSelectedZoneId(expanded ? null : zone.id)}
                        className="flex-1 flex items-center justify-between text-left"
                      >
                        <div>
                          <p className="text-sm font-bold text-slate-800">{zone.nome}</p>
                          <p className="text-xs text-slate-500">
                            {zone.descricao ? zone.descricao : 'Sem descrição cadastrada.'}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[11px] font-semibold text-slate-500">
                            {(zoneLeaders[zone.id]?.length || 0)} líderes
                          </span>
                          <i className={`fas fa-chevron-${expanded ? 'up' : 'down'} text-slate-500`}></i>
                        </div>
                      </button>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleFocusZone(zone)}
                          className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
                          title="Centralizar mapa nesta zona"
                        >
                          Focar
                        </button>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => handleDeleteZone(zone.id)}
                            disabled={zoneDeleting[zone.id]}
                            className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-red-200 text-red-500 hover:bg-red-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Remover zona"
                          >
                            {zoneDeleting[zone.id] ? '...' : 'Excluir'}
                          </button>
                        )}
                      </div>
                    </div>

                    {expanded && (
                      <div className="mt-4 space-y-5">
                        {canEdit ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              handleZoneUpdate(zone.id);
                            }}
                            className="space-y-3"
                          >
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <label className="text-xs font-bold text-slate-500 uppercase">Nome</label>
                                <input
                                  type="text"
                                  value={formState.nome}
                                  onChange={(e) => handleZoneFieldChange(zone.id, 'nome', e.target.value)}
                                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                                />
                              </div>
                              <div>
                                <label className="text-xs font-bold text-slate-500 uppercase">Cor</label>
                                <input
                                  type="color"
                                  value={formState.cor}
                                  onChange={(e) => handleZoneFieldChange(zone.id, 'cor', e.target.value)}
                                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 p-1"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="text-xs font-bold text-slate-500 uppercase">Descrição</label>
                              <textarea
                                value={formState.descricao}
                                onChange={(e) => handleZoneFieldChange(zone.id, 'descricao', e.target.value)}
                                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                                rows={2}
                              />
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="submit"
                                disabled={zoneSavingMap[zone.id]}
                                className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {zoneSavingMap[zone.id] ? <i className="fas fa-spinner fa-spin"></i> : 'Salvar ajustes'}
                              </button>
                              <button
                                type="button"
                                disabled={!mapReady || zoneSavingMap[zone.id]}
                                onClick={() => handleStartDrawing(zone.id)}
                                className="px-4 py-2 rounded-xl border border-indigo-200 text-indigo-600 text-sm font-semibold hover:bg-indigo-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                Redesenhar área
                              </button>
                            </div>
                          </form>
                        ) : (
                          <div className="text-sm text-slate-600">
                            {zone.descricao || 'Sem descrição cadastrada.'}
                          </div>
                        )}

                        {targetZoneForDrawing === zone.id && (
                          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-3">
                            Desenhe no mapa para atualizar a área desta zona.
                          </div>
                        )}

                        <div className="border border-slate-200 rounded-2xl p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-bold text-slate-800">Líderes responsáveis</p>
                              <p className="text-xs text-slate-500">Associe líderes de nível tático à zona.</p>
                            </div>
                          </div>
                          {assignments.length === 0 ? (
                            <p className="text-xs text-slate-500">Nenhum líder foi associado a esta zona.</p>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {assignments.map((assignment) => (
                                <span
                                  key={assignment.id}
                                  className="px-3 py-1.5 rounded-full bg-slate-100 text-xs font-semibold text-slate-700 flex items-center gap-2"
                                >
                                  {assignment.membros?.nome || 'Líder'}
                                  {canEdit && (
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveLeader(zone.id, assignment.id)}
                                      className="text-[10px] text-red-500 hover:text-red-700"
                                    >
                                      <i className="fas fa-times"></i>
                                    </button>
                                  )}
                                </span>
                              ))}
                            </div>
                          )}
                          {canEdit && (
                            <div className="flex flex-col md:flex-row gap-2">
                              <select
                                value={currentLeaderInput}
                                onChange={(e) =>
                                  setLeaderInput((prev) => ({ ...prev, [zone.id]: e.target.value }))
                                }
                                className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                              >
                                <option value="">Selecione um líder</option>
                                {availableLeaders.map((leader) => (
                                  <option key={leader.id} value={leader.id}>
                                    {leader.nome}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                disabled={!currentLeaderInput || leaderAssigning[zone.id]}
                                onClick={() => handleAssignLeader(zone.id)}
                                className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                {leaderAssigning[zone.id] ? 'Adicionando...' : 'Atribuir líder'}
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="border border-slate-200 rounded-2xl p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-bold text-slate-800">Subzonas planejadas</p>
                              <p className="text-xs text-slate-500">
                                Quebre a zona em microáreas para organizar visitas e ações programadas.
                              </p>
                            </div>
                          </div>
                          {subzones.length === 0 ? (
                            <p className="text-xs text-slate-500">Nenhuma subzona cadastrada.</p>
                          ) : (
                            <div className="space-y-2">
                              {subzones
                                .slice()
                                .sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
                                .map((subzona) => (
                                  <div
                                    key={subzona.id}
                                    className="rounded-2xl border border-slate-200 px-3 py-2 bg-slate-50"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <div>
                                        <p className="text-sm font-semibold text-slate-700">{subzona.nome}</p>
                                        {subzona.ordem && (
                                          <span className="text-[11px] uppercase tracking-wide text-slate-400">
                                            #{subzona.ordem}
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <button
                                          type="button"
                                          onClick={() => handleFocusSubzone(zone, subzona)}
                                          className="px-3 py-1 text-[11px] font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-white transition"
                                          title="Centralizar mapa nesta subzona"
                                        >
                                          Focar
                                        </button>
                                        {canEdit && (
                                          <button
                                            type="button"
                                            onClick={() => handleDeleteSubzone(zone.id, subzona.id)}
                                            disabled={subzoneDeleting[subzona.id]}
                                            className="px-3 py-1 text-[11px] font-semibold rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                                            title="Excluir subzona"
                                          >
                                            {subzoneDeleting[subzona.id] ? '...' : 'Excluir'}
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                    {subzona.descricao && (
                                      <p className="text-xs text-slate-500 mt-1">{subzona.descricao}</p>
                                    )}
                                  </div>
                                ))}
                            </div>
                          )}
                          {canEdit && (
                            <form
                              onSubmit={(event) => {
                                event.preventDefault();
                                handleCreateSubzone(zone.id);
                              }}
                              className="space-y-2 pt-2 border-t border-slate-100"
                            >
                              <p className="text-xs font-semibold text-slate-500 uppercase">Nova subzona</p>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <input
                                  type="text"
                                  value={subzoneForm[zone.id]?.nome || ''}
                                  onChange={(e) => handleSubzoneFieldChange(zone.id, 'nome', e.target.value)}
                                  placeholder="Nome da subzona"
                                  className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                                />
                                <input
                                  type="text"
                                  value={subzoneForm[zone.id]?.descricao || ''}
                                  onChange={(e) => handleSubzoneFieldChange(zone.id, 'descricao', e.target.value)}
                                  placeholder="Descrição/observações"
                                  className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                                />
                              </div>
                              <div className="flex justify-end">
                                <button
                                  type="submit"
                                  disabled={subzoneSaving[zone.id]}
                                  className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {subzoneSaving[zone.id] ? 'Salvando...' : 'Adicionar subzona'}
                                </button>
                              </div>
                            </form>
                          )}
                        </div>

                        <div className="border border-dashed border-slate-200 rounded-2xl p-4 bg-slate-50 space-y-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-bold text-slate-800">Agenda tática</p>
                              <p className="text-xs text-slate-500">
                                Programe as ações por subzona, definindo datas, status e responsáveis.
                              </p>
                            </div>
                          </div>

                          {actionTimeline.length === 0 ? (
                            <p className="text-xs text-slate-500">
                              Nenhuma ação agendada para as subzonas desta zona.
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {actionTimeline.map(({ subzona, action }) => {
                                const isEditingAction = editingActionId === action.id;
                                const editState =
                                  editActionForm[action.id] ||
                                  {
                                    subzona_id: action.subzona_id || ZONE_SCOPE,
                                    data: action.data ? action.data.substring(0, 10) : '',
                                    titulo: action.titulo,
                                    descricao: action.descricao || '',
                                    status: action.status,
                                    observacoes: action.observacoes || '',
                                    responsavel_id: action.responsavel_id || ''
                                  };
                                return (
                                  <div key={action.id} className="rounded-2xl bg-white border border-slate-200 p-3 space-y-3">
                                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                      <div>
                                        <p className="text-sm font-bold text-slate-800">{action.titulo}</p>
                                    <p className="text-xs text-slate-500">
                                      {subzona ? `Subzona ${subzona.nome}` : 'Zona completa'}
                                      {action.descricao ? ` • ${action.descricao}` : ''}
                                    </p>
                                        {action.observacoes && (
                                          <p className="text-xs text-slate-400 mt-1">{action.observacoes}</p>
                                        )}
                                        <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px]">
                                          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-semibold">
                                            {action.status.replace(/_/g, ' ')}
                                          </span>
                                          {action.membros?.nome && (
                                            <span className="text-slate-500">Resp.: {action.membros.nome}</span>
                                          )}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-3">
                                        <div className="text-sm font-semibold text-slate-700">
                                          {formatActionDate(action.data)}
                                        </div>
                                        {canEdit && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              isEditingAction ? handleCancelEditAction() : handleStartEditAction(action)
                                            }
                                            className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
                                          >
                                            {isEditingAction ? 'Cancelar' : 'Editar'}
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                    {isEditingAction && canEdit && (
                                      <form
                                        onSubmit={(event) => {
                                          event.preventDefault();
                                          handleUpdateAction(zone.id, action.id);
                                        }}
                                        className="space-y-2 border-t border-slate-200 pt-3"
                                      >
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                          <select
                                            value={editState.subzona_id || ZONE_SCOPE}
                                            onChange={(e) =>
                                              handleEditActionFieldChange(action.id, 'subzona_id', e.target.value)
                                            }
                                            className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                                          >
                                            <option value={ZONE_SCOPE}>Zona completa</option>
                                            {subzones.map((subzonaOption) => (
                                              <option key={subzonaOption.id} value={subzonaOption.id}>
                                                {subzonaOption.nome}
                                              </option>
                                            ))}
                                          </select>
                                          <input
                                            type="date"
                                            value={editState.data}
                                            onChange={(e) => handleEditActionFieldChange(action.id, 'data', e.target.value)}
                                            className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                                          />
                                          <input
                                            type="text"
                                            value={editState.titulo}
                                            onChange={(e) =>
                                              handleEditActionFieldChange(action.id, 'titulo', e.target.value)
                                            }
                                            placeholder="Título da ação"
                                            className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 md:col-span-2"
                                          />
                                          <select
                                            value={editState.status}
                                            onChange={(e) =>
                                              handleEditActionFieldChange(action.id, 'status', e.target.value as ActionStatus)
                                            }
                                            className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                                          >
                                            {ACTION_STATUS_OPTIONS.map((statusOption) => (
                                              <option key={statusOption} value={statusOption}>
                                                {statusOption.replace(/_/g, ' ')}
                                              </option>
                                            ))}
                                          </select>
                                          <select
                                            value={editState.responsavel_id}
                                            onChange={(e) =>
                                              handleEditActionFieldChange(action.id, 'responsavel_id', e.target.value)
                                            }
                                            className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                                          >
                                            <option value="">Responsável (opcional)</option>
                                            {leaders.map((leader) => (
                                              <option key={leader.id} value={leader.id}>
                                                {leader.nome}
                                              </option>
                                            ))}
                                          </select>
                                          <textarea
                                            value={editState.descricao}
                                            onChange={(e) =>
                                              handleEditActionFieldChange(action.id, 'descricao', e.target.value)
                                            }
                                            placeholder="Descrição resumida"
                                            className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 md:col-span-2"
                                            rows={2}
                                          />
                                          <textarea
                                            value={editState.observacoes}
                                            onChange={(e) =>
                                              handleEditActionFieldChange(action.id, 'observacoes', e.target.value)
                                            }
                                            placeholder="Observações táticas"
                                            className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 md:col-span-2"
                                            rows={2}
                                          />
                                        </div>
                                        <div className="flex justify-end gap-2">
                                          <button
                                            type="button"
                                            onClick={handleCancelEditAction}
                                            className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-white transition"
                                          >
                                            Cancelar
                                          </button>
                                          <button
                                            type="submit"
                                            disabled={editActionSaving[action.id]}
                                            className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                                          >
                                            {editActionSaving[action.id] ? 'Salvando...' : 'Atualizar'}
                                          </button>
                                        </div>
                                      </form>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {canEdit && (
                            <form
                              onSubmit={(event) => {
                                event.preventDefault();
                                handleCreateAction(zone.id);
                              }}
                              className="space-y-3 border-t border-slate-200 pt-3"
                            >
                              <p className="text-xs font-semibold text-slate-500 uppercase">Nova ação</p>
                              {subzones.length === 0 && (
                                <p className="text-xs text-slate-500">
                                  Ainda não há subzonas cadastradas. Utilize a opção "Zona completa" para planejar ações gerais.
                                </p>
                              )}
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <select
                                  value={actionState.subzona_id || ZONE_SCOPE}
                                  onChange={(e) => handleActionFieldChange(zone.id, 'subzona_id', e.target.value)}
                                  className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                                >
                                  <option value={ZONE_SCOPE}>Zona completa</option>
                                  {subzones.map((subzona) => (
                                    <option key={subzona.id} value={subzona.id}>
                                      {subzona.nome}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  type="date"
                                  value={actionState.data}
                                  onChange={(e) => handleActionFieldChange(zone.id, 'data', e.target.value)}
                                  className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                                />
                                <input
                                  type="text"
                                  value={actionState.titulo}
                                  onChange={(e) => handleActionFieldChange(zone.id, 'titulo', e.target.value)}
                                  placeholder="Título da ação"
                                  className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 md:col-span-2"
                                />
                                <select
                                  value={actionState.status}
                                  onChange={(e) =>
                                    handleActionFieldChange(zone.id, 'status', e.target.value as ActionStatus)
                                  }
                                  className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                                >
                                  {ACTION_STATUS_OPTIONS.map((statusOption) => (
                                    <option key={statusOption} value={statusOption}>
                                      {statusOption.replace(/_/g, ' ')}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  value={actionState.responsavel_id}
                                  onChange={(e) => handleActionFieldChange(zone.id, 'responsavel_id', e.target.value)}
                                  className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
                                >
                                  <option value="">Responsável (opcional)</option>
                                  {leaders.map((leader) => (
                                    <option key={leader.id} value={leader.id}>
                                      {leader.nome}
                                    </option>
                                  ))}
                                </select>
                                <textarea
                                  value={actionState.descricao}
                                  onChange={(e) => handleActionFieldChange(zone.id, 'descricao', e.target.value)}
                                  placeholder="Descrição resumida"
                                  className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 md:col-span-2"
                                  rows={2}
                                />
                                <textarea
                                  value={actionState.observacoes}
                                  onChange={(e) => handleActionFieldChange(zone.id, 'observacoes', e.target.value)}
                                  placeholder="Observações táticas (instruções de campo, metas etc.)"
                                  className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 md:col-span-2"
                                  rows={2}
                                />
                              </div>
                              <div className="flex justify-end">
                                <button
                                  type="submit"
                                  disabled={actionSaving[zone.id]}
                                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {actionSaving[zone.id] ? 'Agendando...' : 'Registrar ação'}
                                </button>
                              </div>
                            </form>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ZonePlanner;
