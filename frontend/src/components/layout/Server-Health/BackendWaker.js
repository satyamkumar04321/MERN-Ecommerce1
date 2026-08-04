import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { wakeUpServer } from '../../../actions/serverAction';
import './BackendWaker.css';
import logo from '../../../images/Ecommerce-logo.png';

const BackendWaker = ({ children }) => {
  const dispatch = useDispatch();
  const { isAwake } = useSelector(state => state.server);
  const [dots, setDots] = useState('');

  useEffect(() => {
    dispatch(wakeUpServer());

    const interval = setInterval(() => {
      setDots(prev => (prev.length < 3 ? prev + '.' : ''));
    }, 500);
    return () => clearInterval(interval);
  }, [dispatch]);

  if (!isAwake) {
    return (
      <div className="waker-overlay">
        <div className="waker-content">
          <div className="logo-placeholder">
            <img src={logo} alt="Ecommerce Logo" className="waker-logo" />
          </div>
          <h1 className="waker-title">Order Planning</h1>
          <p className="waker-status">Connecting to server{dots}</p>
          <div className="progress-container">
            <div className="progress-bar"></div>
          </div>
        </div>
      </div>
    );
  }

  return children;
};

export default BackendWaker;
