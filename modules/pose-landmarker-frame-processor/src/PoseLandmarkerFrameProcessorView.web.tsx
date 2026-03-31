import * as React from 'react';

import { PoseLandmarkerFrameProcessorViewProps } from './PoseLandmarkerFrameProcessor.types';

export default function PoseLandmarkerFrameProcessorView(props: PoseLandmarkerFrameProcessorViewProps) {
  return (
    <div>
      <iframe
        style={{ flex: 1 }}
        src={props.url}
        onLoad={() => props.onLoad({ nativeEvent: { url: props.url } })}
      />
    </div>
  );
}
