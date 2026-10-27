import { Children, isValidElement, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useLang } from "@rspress/core/runtime";

type PlatformTabProps = { label: string; children: ReactNode };

export function PlatformTab({ children }: PlatformTabProps) {
  return <>{children}</>;
}

export function PlatformTabs({ children }: { children: ReactNode }) {
  const tabs = Children.toArray(children).filter(isValidElement<PlatformTabProps>);
  const id = useId();
  const en = useLang() === "en";
  const [active, setActive] = useState(0);
  const [ready, setReady] = useState(false);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => { setReady(true); }, []);

  function selectWithKeyboard(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    switch (event.key) {
      case "ArrowRight": next = (index + 1) % tabs.length; break;
      case "ArrowLeft": next = (index + tabs.length - 1) % tabs.length; break;
      case "Home": next = 0; break;
      case "End": next = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    setActive(next);
    buttons.current[next]?.focus();
  }

  return <div className="platform-tabs">
    <div className="platform-tabs__choices" role="tablist" aria-label={en ? "Installation platform" : "安装平台"}>
      {tabs.map((tab, index) => <button
        key={tab.props.label}
        ref={(element) => { buttons.current[index] = element; }}
        type="button"
        role="tab"
        id={`${id}-tab-${index}`}
        aria-controls={`${id}-panel-${index}`}
        aria-selected={active === index}
        tabIndex={active === index ? 0 : -1}
        onClick={() => setActive(index)}
        onKeyDown={(event) => selectWithKeyboard(event, index)}
      >{tab.props.label}</button>)}
    </div>
    {tabs.map((tab, index) => <div
      key={tab.props.label}
      className="platform-tabs__panel"
      role="tabpanel"
      id={`${id}-panel-${index}`}
      aria-labelledby={`${id}-tab-${index}`}
      hidden={ready && active !== index}
      tabIndex={0}
    >{tab.props.children}</div>)}
  </div>;
}
