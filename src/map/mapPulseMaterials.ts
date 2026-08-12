import * as THREE from "three";

type PulseShader = {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
};

/**
 * Live `ee` material: water layers — fillPower edge glow + expanding pulse rings.
 * Ported from nlwavemakers.ca HAR (MeshBasicMaterial onBeforeCompile).
 */
export class MapPulseWaterMaterial extends THREE.MeshBasicMaterial {
  private _tint: THREE.Vector3 = new THREE.Vector3(0, 0.5, 1);
  private _center: THREE.Vector3 = new THREE.Vector3();
  private _fillPower = 0;
  private _pulseDistance = 0;
  private _pulseRange = 0;
  private _pulseCount = 0;
  private _pulseFill = 0.2;
  private _pulsePower = 0;
  private _screenSpaceMap = false;
  shader: PulseShader | null = null;

  constructor() {
    super({
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
    });

    this.onBeforeCompile = (shader) => {
      this.shader = shader as unknown as PulseShader;
      shader.uniforms.center = { value: this._center };
      shader.uniforms.tint = { value: this._tint };
      shader.uniforms.fillPower = { value: this._fillPower };
      shader.uniforms.pulseDistance = { value: this._pulseDistance };
      shader.uniforms.pulseRange = { value: this._pulseRange };
      shader.uniforms.pulseCount = { value: this._pulseCount };
      shader.uniforms.pulseFill = { value: this._pulseFill };
      shader.uniforms.pulsePower = { value: this._pulsePower };
      shader.uniforms.screenSpaceMap = { value: this._screenSpaceMap ? 1 : 0 };

      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        `
        #include <common>
        varying float vAspect;
        varying vec3 vWorldPos;
        varying vec4 vClipPos;
      `
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <project_vertex>",
        `
        vAspect =  projectionMatrix[1][1] /  projectionMatrix[0][0];
        vec4 mvPosition = vec4( transformed, 1.0 );

        #ifdef USE_BATCHING
          mvPosition = batchingMatrix * mvPosition;
        #endif

        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif

        vWorldPos =(modelMatrix * mvPosition).xyz;
        mvPosition = modelViewMatrix * mvPosition;

        gl_Position = projectionMatrix * mvPosition;
        vClipPos = gl_Position;
      `
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        `
        #include <common>
        uniform float pulseDistance, pulseRange, pulseCount, pulseFill, pulsePower, fillPower, screenSpaceMap;
        uniform vec3 center, tint;

        varying float vAspect;
        varying vec3 vWorldPos;
        varying vec4 vClipPos;

        #define EIGHTH_TURN 0.78539816339
        #define NINGTH 0.11111111111

        vec4 gausian(sampler2D _tex, vec2 _uv, float _size){
          vec2 radius = vec2(_size, _size * vAspect);
          vec4 sum = texture2D(_tex, _uv);
          for( float d = 0.0; d < 8.0; d ++){
              sum += texture2D( _tex, _uv+vec2(cos(d*EIGHTH_TURN),sin(d*EIGHTH_TURN)) * radius);
          }
          return sum * NINGTH;
        }
        vec3 hardLight(vec3 a, vec3 b){
          return mix(a * b * 2.0, 1.0 - (2.0 * (1.0 - a) * (1.0 - b)), sign(b - 0.5) * 0.5 + 0.5);
        }

        float fromRange (float start, float end, float value){
          return clamp((value - start) / (end - start),0.0, 1.0);
        }
      `
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        `
        gl_FragColor.a = 0.0;
        #ifdef USE_MAP
          vec2 screenUv = (vClipPos.xy / vClipPos.w)*0.5 + 0.5;
          vec2 uv = screenUv * screenSpaceMap + vMapUv * (1.0 - screenSpaceMap);
          vec4 texel = texture2D( map, uv);

          //tint
          vec4 col = vec4(hardLight(texel.rgb, tint), fillPower);

          //pulse
          float fromCenter = length(vWorldPos - center);
          float pulseDelta = clamp((length(fromCenter) - pulseDistance) / pulseRange,0.0,1.0);
          pulseDelta *= ceil(1.0 - abs(pulseDelta - 0.5));
          pulseDelta = abs(sin(pulseDelta * pulseCount * PI));
          float pulseMask =  ceil(pulseDelta - (1.0 - pulseFill)) * pulsePower;
          col.rgb += tint * pulseMask;
          col.a += pulseMask;

          //luma
          float texelMax = max(texel.r, max(texel.g, texel.b));
          float texelMin = min(texel.r, min(texel.g, texel.b));
          float texelDiff = abs(texelMax - texelMin);
          float stepDiff = 1.0 - fromRange(0.1, 0.3, texelDiff);

          float luma = (texel.r + texel.g + texel.b) * 0.333;
          float stepLuma = fromRange(0.3,0.7,luma);
          float lumaMask = 1.0 - mix(0.0, stepDiff , stepLuma);
          col.a *= lumaMask;

          //edge highlight
          vec4 blur = gausian(map, uv, 0.005);
          float edge =  max(0.001,length(texel.rgb -blur.rgb));

          #ifdef USE_AOMAP
            edge += abs(texture2D(aoMap, vMapUv).r - 0.5);
          #endif

          edge *= (1.0 - pulseMask);

          float stepEdge = fromRange(0.0,0.2,edge);
          col += vec4(stepEdge,stepEdge,stepEdge, edge) * 2.0 *  fillPower;

          gl_FragColor = col;
        #endif
      `
      );
    };
  }

  get tint(): THREE.Vector3 {
    return this._tint;
  }
  set tint(value: THREE.Vector3 | [number, number, number]) {
    if (Array.isArray(value)) this._tint.fromArray(value);
    else this._tint.copy(value);
    if (this.shader) this.shader.uniforms.tint.value = this._tint;
  }

  get center(): THREE.Vector3 {
    return this._center;
  }
  set center(value: THREE.Vector3 | [number, number, number]) {
    if (Array.isArray(value)) this._center.fromArray(value);
    else this._center.copy(value);
    if (this.shader) this.shader.uniforms.center.value = this._center;
  }

  get fillPower(): number {
    return this._fillPower;
  }
  set fillPower(value: number) {
    this._fillPower = value;
    if (this.shader) this.shader.uniforms.fillPower.value = value;
  }

  get pulseDistance(): number {
    return this._pulseDistance;
  }
  set pulseDistance(value: number) {
    this._pulseDistance = value;
    if (this.shader) this.shader.uniforms.pulseDistance.value = value;
  }

  get pulseRange(): number {
    return this._pulseRange;
  }
  set pulseRange(value: number) {
    this._pulseRange = value;
    if (this.shader) this.shader.uniforms.pulseRange.value = value;
  }

  get pulseCount(): number {
    return this._pulseCount;
  }
  set pulseCount(value: number) {
    this._pulseCount = value;
    if (this.shader) this.shader.uniforms.pulseCount.value = value;
  }

  get pulseFill(): number {
    return this._pulseFill;
  }
  set pulseFill(value: number) {
    this._pulseFill = value;
    if (this.shader) this.shader.uniforms.pulseFill.value = value;
  }

  get pulsePower(): number {
    return this._pulsePower;
  }
  set pulsePower(value: number) {
    this._pulsePower = value;
    if (this.shader) this.shader.uniforms.pulsePower.value = value;
  }

  get screenSpaceMap(): boolean {
    return this._screenSpaceMap;
  }
  set screenSpaceMap(value: boolean) {
    this._screenSpaceMap = value;
    if (this.shader) this.shader.uniforms.screenSpaceMap.value = value ? 1 : 0;
  }
}

/**
 * Live `et` material: land / NFLD — fillPower edge glow only (no pulse rings).
 */
export class MapPulseLandMaterial extends THREE.MeshBasicMaterial {
  private _fillPower = 0;
  private _screenSpaceMap = false;
  shader: PulseShader | null = null;

  constructor() {
    super({
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
    });

    this.onBeforeCompile = (shader) => {
      this.shader = shader as unknown as PulseShader;
      shader.uniforms.tint = { value: new THREE.Vector3(0, 0.5, 1) };
      shader.uniforms.fillPower = { value: this._fillPower };
      shader.uniforms.screenSpaceMap = { value: this._screenSpaceMap ? 1 : 0 };

      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        `
        #include <common>
        varying float vAspect;
        varying vec4 vClipPos;
      `
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <project_vertex>",
        `
        #include <project_vertex>
        vAspect =  projectionMatrix[1][1] /  projectionMatrix[0][0];
        vClipPos = gl_Position;
      `
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        `
        #include <common>
        uniform float fillPower,screenSpaceMap;
        varying float vAspect;
        varying vec4 vClipPos;

        #define EIGHTH_TURN 0.78539816339
        #define NINGTH 0.11111111111

        vec4 gausian(sampler2D _tex, vec2 _uv, float _size){
          vec2 radius = vec2(_size, _size * vAspect);
          vec4 sum = texture2D(_tex, _uv);
          for( float d = 0.0; d < 8.0; d ++){
              sum += texture2D( _tex, _uv+vec2(cos(d*EIGHTH_TURN),sin(d*EIGHTH_TURN)) * radius);
          }
          return sum * NINGTH;
        }

        float fromRange (float start, float end, float value){
          return clamp((value - start) / (end - start),0.0, 1.0);
        }
      `
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        `
        gl_FragColor.a = 0.0;
        #ifdef USE_MAP
          vec2 screenUv = (vClipPos.xy / vClipPos.w)*0.5 + 0.5;

          vec2 uv = screenUv * screenSpaceMap + vMapUv * (1.0 - screenSpaceMap);
          vec4 texel = texture2D( map, uv);

          vec4 col = vec4(texel.rgb, 0.0);

          //edge highlight
          vec4 blur = gausian(map, uv, 0.005);
          float edge =  max(0.001, length(texel.rgb - blur.rgb));
          #ifdef USE_AOMAP
            edge += abs(texture2D(aoMap, vMapUv).r - 0.5);
          #endif

          float stepEdge = fromRange(0.0,0.5,edge);
          col += vec4(stepEdge,stepEdge,stepEdge, edge) * 4.0 *  fillPower;

          gl_FragColor = col;
        #endif
      `
      );
    };
  }

  get fillPower(): number {
    return this._fillPower;
  }
  set fillPower(value: number) {
    this._fillPower = value;
    if (this.shader) this.shader.uniforms.fillPower.value = value;
  }

  get screenSpaceMap(): boolean {
    return this._screenSpaceMap;
  }
  set screenSpaceMap(value: boolean) {
    this._screenSpaceMap = value;
    if (this.shader) this.shader.uniforms.screenSpaceMap.value = value ? 1 : 0;
  }
}
